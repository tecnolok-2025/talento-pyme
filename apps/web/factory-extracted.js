    requireAuth();
    applyRoleVisibility();
    const role = tpRole();
    if(!['COMPANY','ADMIN'].includes(role)) window.location.href = '/perfil.html';
    document.getElementById('btnLogout').onclick = (e)=>{ e.preventDefault(); logout(); };

    const state = {
      bootstrap: null,
      activeTab: 'summary',
      cart: loadCart(),
      quote: null,
      selectedOrderId: null,
      adminItems: [],
      couponCode: localStorage.getItem('tp_factory_coupon') || '',
      couponFeedback: ''
    };

    const moneyFmt = new Intl.NumberFormat('es-AR');
    const dateFmt = new Intl.DateTimeFormat('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' });
    const els = {
      btnAdminTab: document.getElementById('btnAdminTab'),
      summaryCompanyName: document.getElementById('summaryCompanyName'),
      summaryCompanyMeta: document.getElementById('summaryCompanyMeta'),
      summaryCompanyCode: document.getElementById('summaryCompanyCode'),
      supportEmailLink: document.getElementById('supportEmailLink'),
      kpiOrders: document.getElementById('kpiOrders'),
      kpiPending: document.getElementById('kpiPending'),
      kpiTotal: document.getElementById('kpiTotal'),
      summaryBadge: document.getElementById('summaryBadge'),
      ordersBody: document.getElementById('ordersBody'),
      orderDetailBox: document.getElementById('orderDetailBox'),
      planGrid: document.getElementById('planGrid'),
      cartItems: document.getElementById('cartItems'),
      cartTotals: document.getElementById('cartTotals'),
      cartCount: document.getElementById('cartCount'),
      couponCode: document.getElementById('couponCode'),
      couponMsg: document.getElementById('couponMsg'),
      btnApplyCoupon: document.getElementById('btnApplyCoupon'),
      checkoutCouponCode: document.getElementById('checkoutCouponCode'),
      checkoutCouponMsg: document.getElementById('checkoutCouponMsg'),
      btnApplyCheckoutCoupon: document.getElementById('btnApplyCheckoutCoupon'),
      btnOpenCheckout: document.getElementById('btnOpenCheckout'),
      btnContinueShopping: document.getElementById('btnContinueShopping'),
      checkoutCard: document.getElementById('checkoutCard'),
      checkoutMsg: document.getElementById('checkoutMsg'),
      checkoutItems: document.getElementById('checkoutItems'),
      checkoutTotals: document.getElementById('checkoutTotals'),
      btnBackToCart: document.getElementById('btnBackToCart'),
      btnCheckoutConfirm: document.getElementById('btnCheckoutConfirm'),
      adminSearch: document.getElementById('adminSearch'),
      adminDays: document.getElementById('adminDays'),
      adminSort: document.getElementById('adminSort'),
      btnAdminRefresh: document.getElementById('btnAdminRefresh'),
      adminList: document.getElementById('adminList')
    };

    function esc(s){ return String(s || '').replace(/[&<>"']/g, (c)=> ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
    function money(v){ return '$ ' + moneyFmt.format(Number(v || 0)); }
    function when(v){ try{ return dateFmt.format(new Date(v)); }catch(_){ return '—'; } }
    function statusLabel(status){
      if(status === 'PAID') return 'Pagado';
      if(status === 'VERIFIED') return 'Verificado';
      if(status === 'PENDING_PAYMENT') return 'Pendiente';
      return status || 'Pendiente';
    }
    function loadCart(){
      try{ return JSON.parse(localStorage.getItem('tp_factory_cart') || '[]'); }catch(_){ return []; }
    }
    function syncCouponInputs(){
      if(els.couponCode) els.couponCode.value = state.couponCode || '';
      if(els.checkoutCouponCode) els.checkoutCouponCode.value = state.couponCode || '';
    }
    async function applyCouponCode(rawCode){
      const code = String(rawCode || '').trim().toUpperCase();
      state.couponFeedback = '';
      if(!code){
        state.couponCode = '';
        localStorage.removeItem('tp_factory_coupon');
        state.couponFeedback = 'Ingresá un código de bonificación.';
        await refreshQuote();
        return;
      }
      try{
        const quote = await apiFetch('/factory/quote', { method:'POST', body: JSON.stringify({ items: getQuoteItems(), couponCode: code }) });
        if(!quote.coupon?.valid){
          state.couponCode = '';
          localStorage.removeItem('tp_factory_coupon');
          state.quote = quote;
          state.couponFeedback = (quote.coupon?.message || 'Código no válido.') + ' Se restableció el total inicial.';
          syncCouponInputs();
          renderCart();
          renderCheckout();
          return;
        }
        state.couponCode = code;
        localStorage.setItem('tp_factory_coupon', state.couponCode);
        state.quote = quote;
        state.couponFeedback = quote.coupon?.message || 'Bonificación aplicada correctamente.';
        syncCouponInputs();
        renderCart();
        renderCheckout();
      }catch(e){
        state.couponCode = '';
        localStorage.removeItem('tp_factory_coupon');
        state.couponFeedback = e.message || 'No se pudo validar el código.';
        syncCouponInputs();
        await refreshQuote();
      }
    }
    function saveCart(){
      localStorage.setItem('tp_factory_cart', JSON.stringify(state.cart));
    }
    function getQuoteItems(){
      return state.cart.map((it)=> ({ planCode: it.planCode, quantity: it.quantity }));
    }
    function setTab(tab){
      state.activeTab = tab;
      document.querySelectorAll('#segmentTabs [data-tab]').forEach((btn)=> btn.classList.toggle('active', btn.dataset.tab === tab));
      document.querySelectorAll('.factorySection').forEach((sec)=> sec.classList.toggle('active', sec.id === 'tab-' + tab));
      if(tab === 'admin' && !state.adminItems.length) loadAdmin();
      if(tab === 'plans') renderCheckout();
    }
    document.querySelectorAll('#segmentTabs [data-tab]').forEach((btn)=> btn.onclick = ()=> setTab(btn.dataset.tab));

    function updateNavAdmin(roleExact){
      const isAdmin = roleExact === 'SUPERADMIN' || roleExact === 'ADMIN';
      els.btnAdminTab.style.display = isAdmin ? '' : 'none';
    }

    async function refreshQuote(){
      syncCouponInputs();
      if(!state.cart.length){
        state.quote = { items: [], subtotal: 0, discountAmount: 0, vatAmount: 0, total: 0, coupon: { message: '' }, totalDays: 0 };
        renderCart();
        renderCheckout();
        return;
      }
      try{
        state.quote = await apiFetch('/factory/quote', { method:'POST', body: JSON.stringify({ items: getQuoteItems(), couponCode: state.couponCode }) });
      }catch(e){
        state.quote = { items: [], subtotal: 0, discountAmount: 0, vatAmount: 0, total: 0, coupon: { message: e.message }, totalDays: 0 };
      }
      renderCart();
      renderCheckout();
    }

    function planByCode(code){
      return (state.bootstrap?.plans || []).find((it)=> it.code === code) || null;
    }
    function addPlan(code){
      state.couponFeedback = '';
      const row = state.cart.find((it)=> it.planCode === code);
      if(row) row.quantity += 1;
      else state.cart.push({ planCode: code, quantity: 1 });
      saveCart();
      refreshQuote();
    }
    function changeQty(code, delta){
      state.couponFeedback = '';
      const row = state.cart.find((it)=> it.planCode === code);
      if(!row) return;
      row.quantity = Math.max(1, row.quantity + delta);
      saveCart();
      refreshQuote();
    }
    function removeFromCart(code){
      state.couponFeedback = '';
      state.cart = state.cart.filter((it)=> it.planCode !== code);
      saveCart();
      refreshQuote();
    }

    function renderSummary(){
      const boot = state.bootstrap;
      if(!boot) return;
      const company = boot.company || {};
      els.summaryCompanyName.textContent = company.companyName || 'Empresa registrada';
      els.summaryCompanyMeta.textContent = `${company.contactEmail || 'sin mail'}${company.cuit ? ' • CUIT ' + company.cuit : ''}`;
      els.summaryCompanyCode.textContent = `Cuenta TP · ${company.companyCode || '—'}`;
      els.supportEmailLink.textContent = boot.supportEmail || 'factory@gmail.com';
      els.supportEmailLink.href = `mailto:${boot.supportEmail || 'factory@gmail.com'}`;
      els.kpiOrders.textContent = String(boot.totals?.orders || 0);
      els.kpiPending.textContent = money(boot.totals?.pending || 0);
      els.kpiTotal.textContent = money(boot.totals?.total || 0);
      const orders = boot.orders || [];
      els.summaryBadge.textContent = orders.length ? `${orders.length} documento(s)` : 'Sin documentos todavía';
      if(!orders.length){
        els.ordersBody.innerHTML = `<tr><td colspan="9"><div class="emptyStateFactory">Todavía no hay documentos emitidos. Cuando verifiques una compra desde Factory, la operación quedará registrada acá.</div></td></tr>`;
        els.orderDetailBox.innerHTML = '';
        return;
      }
      els.ordersBody.innerHTML = orders.map((order)=> `
        <tr>
          <td><b>${esc(order.companyName)}</b><div class="muted monoData">Código ${esc(order.companyCode)}</div></td>
          <td>${esc(order.docType)}</td>
          <td class="monoData">${esc(order.documentNo)}</td>
          <td>${when(order.date)}</td>
          <td>${when(order.dueDate)}</td>
          <td><span class="statusPill ${esc(order.status)}">${esc(statusLabel(order.status))}</span></td>
          <td>${money(order.amount)}</td>
          <td>${esc(order.currency)}</td>
          <td><button class="btn btn-ghost btnOrderDetail" type="button" data-id="${order.id}">${state.selectedOrderId === order.id ? 'Ocultar' : 'Ver'}</button></td>
        </tr>`).join('');
      els.ordersBody.querySelectorAll('.btnOrderDetail').forEach((btn)=> btn.onclick = ()=> {
        state.selectedOrderId = state.selectedOrderId === btn.dataset.id ? null : btn.dataset.id;
        renderSummary();
      });
      const active = orders.find((it)=> it.id === state.selectedOrderId) || null;
      if(!active){
        els.orderDetailBox.innerHTML = '';
        return;
      }
      els.orderDetailBox.innerHTML = `
        <div class="orderDetailsCard">
          <div class="toolbarCard">
            <div>
              <div class="small pageEyebrow" style="color:var(--tp-blue-900)">Detalle del documento</div>
              <div style="font-size:22px;font-weight:900;margin-top:6px">${esc(active.documentNo)}</div>
            </div>
            <div class="badge">${esc(statusLabel(active.status))}</div>
          </div>
          <div class="grid2" style="margin-top:16px">
            <div>
              <div><b>Empresa:</b> ${esc(active.companyName)}</div>
              <div><b>Días contratados:</b> ${esc(active.days || 0)}</div>
              <div><b>Tarjeta:</b> ${active.cardLast4 ? '•••• ' + esc(active.cardLast4) : 'Pendiente'}</div>
            </div>
            <div>
              <div><b>Facturar a:</b> ${esc(active.billingName || 's/d')}</div>
              <div><b>CUIT:</b> ${esc(active.billingTaxId || 's/d')}</div>
              <div><b>E-mail:</b> ${esc(active.billingEmail || 's/d')}</div>
            </div>
          </div>
          <div class="factoryTableWrap">
            <table class="factoryTable" style="min-width:520px">
              <thead><tr><th>Plan</th><th>Días</th><th>Cantidad</th><th>Subtotal</th></tr></thead>
              <tbody>${(active.items || []).map((it)=> `<tr><td>${esc(it.planName)}</td><td>${esc(it.days)}</td><td>${esc(it.quantity)}</td><td>${money(it.subtotal)}</td></tr>`).join('')}</tbody>
            </table>
          </div>
          <div class="cartTotals">
            <div class="cartLine"><span>Subtotal</span><b>${money(active.totals.subtotal)}</b></div>
            <div class="cartLine"><span>Bonificación</span><b>${money(active.totals.discountAmount)}</b></div>
            <div class="cartLine"><span>IVA (21%)</span><b>${money(active.totals.vatAmount)}</b></div>
            <div class="cartLine total"><span>Total</span><b>${money(active.totals.total)}</b></div>
          </div>
        </div>`;
    }

    function renderPlans(){
      const plans = state.bootstrap?.plans || [];
      els.planGrid.innerHTML = plans.map((plan)=> `
        <div class="planCard">
          <div class="planDays">${plan.days} días</div>
          <div class="planName">${esc(plan.name)}</div>
          <div class="planPrice">${money(plan.price)}<small> ARS</small></div>
          <div class="planLead">${esc(plan.highlight || '')}</div>
          <div class="timelineNote">Podrás publicar avisos durante ${plan.days} días con el mismo nivel de servicio que el resto de los planes.</div>
          <div class="planFoot">
            <span class="planBadge">Contratación por tiempo</span>
            <button class="btn btn-primary" type="button" data-plan="${plan.code}">Agregar al carrito</button>
          </div>
        </div>`).join('');
      els.planGrid.querySelectorAll('[data-plan]').forEach((btn)=> btn.onclick = ()=> addPlan(btn.dataset.plan));
    }

    function renderCart(){
      const count = state.cart.reduce((acc, it)=> acc + it.quantity, 0);
      els.cartCount.textContent = `${count} ítem${count===1?'':'s'}`;
      if(!state.cart.length){
        els.cartItems.innerHTML = '<div class="emptyStateFactory" style="margin-top:14px">Todavía no agregaste planes. Elegí uno de los tiempos de publicación para armar la compra.</div>';
        els.cartTotals.innerHTML = '<div class="cartLine"><span>Subtotal</span><b>$ 0</b></div><div class="cartLine total"><span>Total</span><b>$ 0</b></div>';
        els.couponMsg.textContent = state.couponFeedback || 'Ingresá un código de bonificación para intentar aplicarlo al total.';
        if(els.checkoutCouponMsg) els.checkoutCouponMsg.textContent = state.couponFeedback || 'Si el código es válido, el total se recalcula automáticamente.';
        return;
      }
      els.cartItems.innerHTML = state.cart.map((row)=> {
        const plan = planByCode(row.planCode) || { name: row.planCode, days: 0, price: 0 };
        return `
          <div class="cartItem">
            <div class="cartItemHead">
              <div>
                <div style="font-weight:900;font-size:18px">${esc(plan.name)}</div>
                <div class="muted">${plan.days} días de publicación</div>
              </div>
              <button class="btn btn-ghost" type="button" data-remove="${plan.code}">Quitar</button>
            </div>
            <div class="rowBetween" style="margin-top:14px">
              <div class="qtyPill">
                <button type="button" data-qty="${plan.code}" data-delta="-1">−</button>
                <b>${row.quantity}</b>
                <button type="button" data-qty="${plan.code}" data-delta="1">+</button>
              </div>
              <div style="font-size:24px;font-weight:950">${money(plan.price * row.quantity)}</div>
            </div>
          </div>`;
      }).join('');
      els.cartItems.querySelectorAll('[data-remove]').forEach((btn)=> btn.onclick = ()=> removeFromCart(btn.dataset.remove));
      els.cartItems.querySelectorAll('[data-qty]').forEach((btn)=> btn.onclick = ()=> changeQty(btn.dataset.qty, Number(btn.dataset.delta || 0)));
      const q = state.quote || { subtotal: 0, discountAmount: 0, vatAmount: 0, total: 0, coupon: { message: '' }, totalDays: 0 };
      els.couponMsg.textContent = state.couponFeedback || q.coupon?.message || 'Ingresá un código de bonificación para intentar aplicarlo al total.';
      if(els.checkoutCouponMsg) els.checkoutCouponMsg.textContent = state.couponFeedback || q.coupon?.message || 'Si el código es válido, el total se recalcula automáticamente.';
      els.cartTotals.innerHTML = `
        <div class="cartLine"><span>Subtotal</span><b>${money(q.subtotal)}</b></div>
        <div class="cartLine"><span>Bonificaciones</span><b>${money(q.discountAmount)}</b></div>
        <div class="cartLine"><span>IVA (21%)</span><b>${money(q.vatAmount)}</b></div>
        <div class="cartLine"><span>Días acumulados</span><b>${q.totalDays || 0}</b></div>
        <div class="cartLine total"><span>Total</span><b>${money(q.total)}</b></div>`;
    }

    function prefillCheckout(){
      const c = state.bootstrap?.company || {};
      document.getElementById('billingName').value = c.companyName || '';
      document.getElementById('billingTaxId').value = c.cuit || '';
      document.getElementById('billingTaxCondition').value = 'Responsable Inscripto';
      document.getElementById('billingProvince').value = c.province || '';
      document.getElementById('billingCity').value = c.city || '';
      document.getElementById('billingStreet').value = c.address || '';
      document.getElementById('billingNumber').value = '';
      document.getElementById('billingFloor').value = '';
      document.getElementById('billingDept').value = '';
      document.getElementById('billingPostalCode').value = '';
      document.getElementById('billingEmail').value = c.contactEmail || '';
      document.getElementById('cardBrand').value = '';
      document.getElementById('cardNumber').value = '';
      document.getElementById('cardHolder').value = c.contactName || '';
      document.getElementById('cardExpiry').value = '';
      document.getElementById('cardCvv').value = '';
    }

    function renderCheckout(){
      const q = state.quote || { items: [], subtotal:0, discountAmount:0, vatAmount:0, total:0 };
      const visible = state.activeTab === 'plans' && state.cart.length > 0 && els.checkoutCard.style.display !== 'none';
      els.checkoutCard.style.display = (state.activeTab === 'plans' && state.cart.length > 0 && visible) ? '' : els.checkoutCard.style.display;
      els.checkoutItems.innerHTML = (q.items || []).map((it)=> `
        <div class="cartItem" style="margin-top:0;margin-bottom:12px">
          <div style="font-weight:900">${esc(it.planName)}</div>
          <div class="muted">${it.quantity} unidad(es) · ${it.days} días</div>
          <div style="margin-top:8px;font-size:22px;font-weight:950">${money(it.subtotal)}</div>
        </div>`).join('') || '<div class="emptyStateFactory">Todavía no hay items en el resumen.</div>';
      els.checkoutTotals.innerHTML = `
        <div class="cartLine"><span>Subtotal</span><b>${money(q.subtotal || 0)}</b></div>
        <div class="cartLine"><span>Bonificaciones</span><b>${money(q.discountAmount || 0)}</b></div>
        <div class="cartLine"><span>IVA (21%)</span><b>${money(q.vatAmount || 0)}</b></div>
        <div class="cartLine total"><span>Total</span><b>${money(q.total || 0)}</b></div>`;
    }

    async function loadAdmin(){
      els.adminList.innerHTML = '<div class="emptyStateFactory">Cargando panel administrador…</div>';
      try{
        const data = await apiFetch('/factory/admin/orders?' + new URLSearchParams({
          q: els.adminSearch.value.trim(),
          days: els.adminDays.value,
          sort: els.adminSort.value
        }).toString());
        state.adminItems = data.items || [];
        if(!state.adminItems.length){
          els.adminList.innerHTML = '<div class="emptyStateFactory">Todavía no hay compras registradas para mostrar en la vista general.</div>';
          return;
        }
        els.adminList.innerHTML = state.adminItems.map((group)=> `
          <details class="adminCompanyGroup">
            <summary>${esc(group.companyName)} <span class="muted monoData">· ${esc(group.companyCode || '')}</span></summary>
            <div class="factoryTableWrap" style="margin-top:12px">
              <table class="factoryTable" style="min-width:720px">
                <thead><tr><th>Documento</th><th>Fecha</th><th>Días</th><th>Estado</th><th>Total</th></tr></thead>
                <tbody>${(group.documents || []).map((doc)=> `<tr><td>${esc(doc.documentNo)}</td><td>${when(doc.date)}</td><td>${doc.days || 0}</td><td><span class="statusPill ${esc(doc.status)}">${esc(statusLabel(doc.status))}</span></td><td>${money(doc.totals.total)}</td></tr>`).join('')}</tbody>
              </table>
            </div>
          </details>`).join('');
      }catch(e){
        els.adminList.innerHTML = `<div class="emptyStateFactory">${esc(e.message)}</div>`;
      }
    }

    async function loadBootstrap(){
      const boot = await apiFetch('/factory/bootstrap');
      state.bootstrap = boot;
      updateNavAdmin(boot.role);
      renderSummary();
      renderPlans();
      await refreshQuote();
    }

    els.btnApplyCoupon.onclick = async ()=> { await applyCouponCode(els.couponCode.value); };
    if(els.btnApplyCheckoutCoupon) els.btnApplyCheckoutCoupon.onclick = async ()=> { await applyCouponCode(els.checkoutCouponCode.value); };
    els.btnContinueShopping.onclick = ()=> setTab('plans');
    els.btnOpenCheckout.onclick = ()=> {
      if(!state.cart.length){ els.couponMsg.textContent = 'Primero agregá al menos un plan al carrito.'; return; }
      setTab('plans');
      els.checkoutCard.style.display = '';
      prefillCheckout();
      renderCheckout();
      els.checkoutCard.scrollIntoView({ behavior:'smooth', block:'start' });
    };
    els.btnBackToCart.onclick = ()=> {
      els.checkoutCard.style.display = 'none';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    els.btnCheckoutConfirm.onclick = async ()=> {
      els.checkoutMsg.textContent = 'Verificando compra…';
      try{
        const payload = {
          items: getQuoteItems(),
          couponCode: state.couponCode,
          billing: {
            razonSocial: document.getElementById('billingName').value.trim(),
            cuit: document.getElementById('billingTaxId').value.trim(),
            condicionFiscal: document.getElementById('billingTaxCondition').value.trim(),
            provincia: document.getElementById('billingProvince').value.trim(),
            localidad: document.getElementById('billingCity').value.trim(),
            calle: document.getElementById('billingStreet').value.trim(),
            numero: document.getElementById('billingNumber').value.trim(),
            piso: document.getElementById('billingFloor').value.trim(),
            depto: document.getElementById('billingDept').value.trim(),
            codigoPostal: document.getElementById('billingPostalCode').value.trim(),
            email: document.getElementById('billingEmail').value.trim()
          },
          payment: {
            cardNumber: document.getElementById('cardNumber').value.trim(),
            cardHolder: document.getElementById('cardHolder').value.trim(),
            cardBrand: document.getElementById('cardBrand').value.trim(),
            expiry: document.getElementById('cardExpiry').value.trim(),
            cvv: document.getElementById('cardCvv').value.trim()
          }
        };
        const data = await apiFetch('/factory/checkout', { method:'POST', body: JSON.stringify(payload) });
        els.checkoutMsg.textContent = data.message || 'Compra verificada.';
        state.cart = [];
        saveCart();
        state.couponCode = '';
        state.couponFeedback = '';
        localStorage.removeItem('tp_factory_coupon');
        syncCouponInputs();
        els.checkoutCard.style.display = 'none';
        state.selectedOrderId = data.order?.id || null;
        await loadBootstrap();
        setTab('summary');
      }catch(e){
        els.checkoutMsg.textContent = e.message;
      }
    };
    els.btnAdminRefresh.onclick = loadAdmin;

    loadBootstrap().catch((e)=> {
      els.summaryBadge.textContent = e.message;
      els.ordersBody.innerHTML = `<tr><td colspan="9"><div class="emptyStateFactory">${esc(e.message)}</div></td></tr>`;
    });