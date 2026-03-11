
    requireAuth();
    applyRoleVisibility();
    if(!['COMPANY','ADMIN'].includes(tpRole())) window.location.href = '/perfil.html';
    document.getElementById('btnLogout').onclick = (e)=>{ e.preventDefault(); logout(); };

    const state = {
      bootstrap: null,
      adminBootstrap: null,
      activeTab: 'summary',
      cart: loadCart(),
      quote: null,
      selectedOrderId: null,
      adminItems: [],
      couponCode: localStorage.getItem('tp_factory_coupon') || '',
      couponFeedback: '',
      adminAlias: localStorage.getItem('tp_factory_admin_alias') || '',
      adminPassword: localStorage.getItem('tp_factory_admin_password') || '',
      pendingApprovedOrder: null
    };

    const moneyFmt = new Intl.NumberFormat('es-AR');
    const dateFmt = new Intl.DateTimeFormat('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' });
    const monthsFmt = new Intl.DateTimeFormat('es-AR', { month:'long', year:'numeric' });

    function esc(s){ return String(s || '').replace(/[&<>"']/g, (c)=> ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
    function money(v){ return '$' + moneyFmt.format(Number(v || 0)); }
    function when(v){ try{ return dateFmt.format(new Date(v)); }catch(_){ return '—'; } }
    function statusLabel(status){ return ({ PAID:'Pagado', VERIFIED:'Verificado', PENDING_PAYMENT:'Pendiente', CANCELLED:'Cancelado' }[status] || status || 'Pendiente'); }
    function loadCart(){ try{ return JSON.parse(localStorage.getItem('tp_factory_cart') || '[]'); }catch(_){ return []; } }
    function saveCart(){ localStorage.setItem('tp_factory_cart', JSON.stringify(state.cart)); }
    function getQuoteItems(){ return state.cart.map((it)=> ({ planCode: it.planCode, quantity: it.quantity })); }
    function syncCouponInputs(){ document.getElementById('couponCode').value = state.couponCode || ''; document.getElementById('checkoutCouponCode').value = state.couponCode || ''; }
    function clearCheckoutResult(){ const box = document.getElementById('checkoutResult'); box.style.display='none'; box.innerHTML=''; state.pendingApprovedOrder = null; }
    function showCheckoutResult(data){
      const box = document.getElementById('checkoutResult');
      const order = data?.order || {};
      const usage = data?.operationUsage || state.bootstrap?.operationUsage || {};
      box.style.display='';
      box.innerHTML = `<div class="payResult"><div class="small pageEyebrow" style="color:var(--tp-blue-900)">Compra virtual aprobada</div><h3>Pago autorizado en entorno de prueba</h3><div class="muted">${esc(data?.message || 'La compra quedó aprobada y la capacidad fue habilitada en el momento.')}</div><div class="payMeta"><div class="payMetaCard"><div class="mutedInline">Autorización</div><div style="font-size:20px;font-weight:900;margin-top:6px">${esc(data?.payment?.authorizationCode || '—')}</div></div><div class="payMetaCard"><div class="mutedInline">Tarjeta</div><div style="font-size:20px;font-weight:900;margin-top:6px">${esc(data?.payment?.brand || order.cardBrand || '—')} •••• ${esc(data?.payment?.last4 || order.cardLast4 || '—')}</div></div><div class="payMetaCard"><div class="mutedInline">Capacidad habilitada</div><div style="font-size:20px;font-weight:900;margin-top:6px">${Number(order.days || 0)} días</div><div class="mutedInline">${Number(order.totalPublications || data?.quote?.totalPublications || 0)} publicaciones · ${Number(order.totalOpenings || data?.quote?.totalOpenings || 0)} búsquedas</div></div><div class="payMetaCard"><div class="mutedInline">Saldo operativo actual</div><div style="font-size:20px;font-weight:900;margin-top:6px">${usage.fullAccess ? '∞' : `${Number(usage.remainingPublications || 0)} pub. / ${Number(usage.remainingSearches || usage.remainingOpenings || 0)} búsq.`}</div></div></div><div class="timelineNote">El sistema registró esta operación como simulación segura. Solo se guardaron la marca y los últimos 4 dígitos de la tarjeta para auditoría.</div><div class="row" style="margin-top:14px"><button class="btn btn-primary" type="button" id="btnGoSummary">Ir al resumen de cuenta</button></div></div>`;
      document.getElementById('btnGoSummary').onclick = async ()=> {
        clearCheckoutResult();
        state.quote = { items: [], subtotal:0, discountAmount:0, vatAmount:0, total:0, totalDays:0, totalPublications:0, totalOpenings:0, coupon:{message:''} };
        document.getElementById('checkoutCard').style.display='none';
        await loadBootstrap();
        setTab('summary');
      };
    }
    function factoryHeaders(){ const headers = {}; if(state.adminAlias) headers['x-factory-admin-alias'] = state.adminAlias; if(state.adminPassword) headers['x-factory-admin-password'] = state.adminPassword; if(state.adminPassword) headers['x-factory-admin-key'] = state.adminPassword; return headers; }
    async function apiFactory(path, options = {}, admin = false){ const headers = Object.assign({}, options.headers || {}, factoryHeaders(admin)); return apiFetch(path, Object.assign({}, options, { headers })); }
    function monthChoices(){ const base = new Date(); const arr = []; for(let i=0;i<12;i++){ const d = new Date(base.getFullYear(), base.getMonth()+i, 1); const value = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; arr.push({ value, label: monthsFmt.format(d) }); } return arr; }
    function quotaLineHTML(op){
      if(!op) return '';
      if(op.fullAccess) return `<span class="quotaPill">Acceso total hasta ${esc(when(op.fullAccessUntil))}</span>`;
      return `
        <span class="quotaPill">Publicaciones disponibles: ${esc(op.remainingPublications || 0)}</span>
        <span class="quotaPill">Búsquedas disponibles: ${esc(op.remainingSearches || 0)}</span>
        <span class="quotaPill">Capacidad total vigente: ${esc(op.totalPublications || 0)} pub. / ${esc(op.totalSearches || 0)} búsq.</span>`;
    }

    function planByCode(code){ return (state.bootstrap?.plans || []).find((it)=> it.code === code) || null; }
    function setTab(tab){
      state.activeTab = tab;
      document.querySelectorAll('#segmentTabs [data-tab]').forEach((btn)=> btn.classList.toggle('active', btn.dataset.tab === tab));
      document.querySelectorAll('.factorySection').forEach((sec)=> sec.classList.toggle('active', sec.id === 'tab-' + tab));
      if(tab === 'admin') renderAdminSection();
      if(tab === 'plans') renderCheckout();
    }
    document.querySelectorAll('#segmentTabs [data-tab]').forEach((btn)=> btn.onclick = ()=> setTab(btn.dataset.tab));

    function updateAdminVisibility(){
      const unlocked = !!state.bootstrap?.adminUnlocked;
      document.getElementById('btnAdminTab').style.display = unlocked ? '' : 'none';
      document.getElementById('adminUnlockCard').style.display = unlocked ? 'none' : '';
      document.getElementById('adminConsole').style.display = unlocked ? '' : 'none';
      document.getElementById('adminGateMsg').textContent = unlocked ? 'Consola habilitada. Podés actualizar matriz, bonos y accesos especiales.' : 'Ingresá el nombre Factory y la clave de acceso para habilitar este panel.';
    }

    async function loadBootstrap(){
      state.bootstrap = await apiFactory('/factory/bootstrap');
      document.getElementById('factoryAdminAlias').value = state.adminAlias || state.bootstrap?.factoryAdmin?.aliasHint || '';
      document.getElementById('factoryAdminPassword').value = state.adminPassword || '';
      renderSummary();
      renderPlans();
      await refreshQuote();
      updateAdminVisibility();
      if(state.bootstrap.adminUnlocked) await loadAdminBootstrap();
    }

    async function refreshQuote(){
      syncCouponInputs();
      if(!state.cart.length){
        state.quote = { items: [], subtotal:0, discountAmount:0, vatAmount:0, total:0, totalDays:0, totalPublications:0, totalOpenings:0, coupon:{message:''} };
        renderCart(); renderCheckout(); return;
      }
      try{ state.quote = await apiFactory('/factory/quote', { method:'POST', body: JSON.stringify({ items: getQuoteItems(), couponCode: state.couponCode }) }); }
      catch(e){ state.quote = { items: [], subtotal:0, discountAmount:0, vatAmount:0, total:0, totalDays:0, totalPublications:0, totalOpenings:0, coupon:{message:e.message} }; }
      renderCart(); renderCheckout();
    }

    async function applyCouponCode(raw){
      const code = String(raw || '').trim().toUpperCase();
      state.couponFeedback = '';
      if(!code){ state.couponCode = ''; localStorage.removeItem('tp_factory_coupon'); state.couponFeedback = 'Ingresá un código de bonificación.'; await refreshQuote(); return; }
      try{
        const quote = await apiFactory('/factory/quote', { method:'POST', body: JSON.stringify({ items: getQuoteItems(), couponCode: code }) });
        if(!quote.coupon?.valid){ state.couponCode=''; localStorage.removeItem('tp_factory_coupon'); state.quote=quote; state.couponFeedback=(quote.coupon?.message||'Código no válido.')+' Se restableció el total inicial.'; syncCouponInputs(); renderCart(); renderCheckout(); return; }
        state.couponCode = code; localStorage.setItem('tp_factory_coupon', code); state.quote = quote; state.couponFeedback = quote.coupon?.message || 'Bonificación aplicada correctamente.'; syncCouponInputs(); renderCart(); renderCheckout();
      }catch(e){ state.couponCode=''; localStorage.removeItem('tp_factory_coupon'); state.couponFeedback = e.message || 'No se pudo validar el código.'; syncCouponInputs(); await refreshQuote(); }
    }

    function addPlan(code){ const row = state.cart.find((it)=> it.planCode === code); if(row) row.quantity += 1; else state.cart.push({ planCode: code, quantity: 1 }); saveCart(); refreshQuote(); }
    function changeQty(code, delta){ const row = state.cart.find((it)=> it.planCode === code); if(!row) return; row.quantity = Math.max(1, row.quantity + delta); saveCart(); refreshQuote(); }
    function removeFromCart(code){ state.cart = state.cart.filter((it)=> it.planCode !== code); saveCart(); refreshQuote(); }

    function renderSummary(){
      const boot = state.bootstrap; if(!boot) return;
      const company = boot.company || {}; const op = boot.operationUsage || boot.openingUsage || {};
      document.getElementById('summaryCompanyName').textContent = company.companyName || 'Empresa registrada';
      document.getElementById('summaryCompanyMeta').textContent = `${company.contactEmail || 'sin mail'}${company.cuit ? ' • CUIT ' + company.cuit : ''}`;
      document.getElementById('summaryCompanyCode').textContent = `Cuenta TP · ${company.companyCode || '—'}`;
      const support = boot.supportEmail || 'factory@gmail.com';
      const supportEl = document.getElementById('supportEmailLink'); supportEl.textContent = support; supportEl.href = `mailto:${support}`;
      document.getElementById('kpiOrders').textContent = String(boot.totals?.orders || 0);
      document.getElementById('kpiTotal').textContent = money(boot.totals?.total || 0);
      document.getElementById('kpiPublications').textContent = op.fullAccess ? '∞' : String(op.remainingPublications || 0);
      document.getElementById('kpiSearches').textContent = op.fullAccess ? '∞' : String(op.remainingSearches || op.remainingOpenings || 0);
      document.getElementById('quotaLineSummary').innerHTML = quotaLineHTML(op);
      document.getElementById('quotaSummaryMsg').textContent = op.fullAccess ? `La empresa tiene acceso total habilitado hasta ${when(op.fullAccessUntil)}.` : `Capacidad usada: ${op.usedPublications || 0} publicaciones y ${op.usedSearches || op.usedOpenings || 0} búsquedas.`;
      const orders = boot.orders || [];
      document.getElementById('summaryBadge').textContent = orders.length ? `${orders.length} documento(s)` : 'Sin documentos todavía';
      const tbody = document.getElementById('ordersBody');
      if(!orders.length){ tbody.innerHTML = `<tr><td colspan="9"><div class="emptyStateFactory">Todavía no hay documentos emitidos.</div></td></tr>`; document.getElementById('orderDetailBox').innerHTML=''; return; }
      tbody.innerHTML = orders.map((order)=> `<tr><td><b>${esc(order.companyName)}</b><div class="muted monoData">Código ${esc(order.companyCode)}</div></td><td>${esc(order.docType)}</td><td class="monoData">${esc(order.documentNo)}</td><td>${when(order.date)}</td><td>${when(order.dueDate)}</td><td><span class="statusPill ${esc(order.status)}">${esc(statusLabel(order.status))}</span></td><td>${money(order.amount)}</td><td>${esc(order.currency)}</td><td><button class="btn btn-ghost btnOrderDetail" type="button" data-id="${order.id}">${state.selectedOrderId === order.id ? 'Ocultar' : 'Ver'}</button></td></tr>`).join('');
      tbody.querySelectorAll('.btnOrderDetail').forEach((btn)=> btn.onclick = ()=>{ state.selectedOrderId = state.selectedOrderId === btn.dataset.id ? null : btn.dataset.id; renderSummary(); });
      const active = orders.find((it)=> it.id === state.selectedOrderId);
      if(!active){ document.getElementById('orderDetailBox').innerHTML=''; return; }
      document.getElementById('orderDetailBox').innerHTML = `
        <div class="orderDetailsCard">
          <div class="toolbarCard"><div><div class="small pageEyebrow" style="color:var(--tp-blue-900)">Detalle del documento</div><div style="font-size:22px;font-weight:900;margin-top:6px">${esc(active.documentNo)}</div></div><div class="badge">${esc(statusLabel(active.status))}</div></div>
          <div class="grid2" style="margin-top:16px">
            <div><div><b>Empresa:</b> ${esc(active.companyName)}</div><div><b>Días contratados:</b> ${esc(active.days || 0)}</div><div><b>Tarjeta:</b> ${active.cardLast4 ? '•••• ' + esc(active.cardLast4) : 'Pendiente'}</div></div>
            <div><div><b>Facturar a:</b> ${esc(active.billingName || 's/d')}</div><div><b>CUIT:</b> ${esc(active.billingTaxId || 's/d')}</div><div><b>E-mail:</b> ${esc(active.billingEmail || 's/d')}</div></div>
          </div>
          <div class="factoryTableWrap"><table class="factoryTable" style="min-width:620px"><thead><tr><th>Plan</th><th>Días</th><th>Publicaciones</th><th>Búsquedas</th><th>Cantidad</th><th>Subtotal</th></tr></thead><tbody>${(active.items || []).map((it)=> `<tr><td>${esc(it.planName)}</td><td>${esc(it.days)}</td><td>${esc(it.publicationsIncluded || 0)}</td><td>${esc(it.searchesIncluded || it.openingsIncluded || 0)}</td><td>${esc(it.quantity)}</td><td>${money(it.subtotal)}</td></tr>`).join('')}</tbody></table></div>
          <div class="cartTotals"><div class="cartLine"><span>Subtotal</span><b>${money(active.totals.subtotal)}</b></div><div class="cartLine"><span>Bonificación</span><b>${money(active.totals.discountAmount)}</b></div><div class="cartLine"><span>IVA (21%)</span><b>${money(active.totals.vatAmount)}</b></div><div class="cartLine total"><span>Total</span><b>${money(active.totals.total)}</b></div></div>
        </div>`;
    }

    function renderPlans(){
      const plans = state.bootstrap?.plans || [];
      document.getElementById('planGrid').innerHTML = plans.map((plan)=> `
        <div class="planCard">
          <div class="planDays">${plan.days} días</div>
          <div class="planName">${esc(plan.name)}</div>
          <div class="planPrice">${money(plan.price)}<small> ARS</small></div>
          <div class="planLead">${esc(plan.highlight || '')}</div>
          <div class="quotaLine"><span class="quotaPill">${plan.publications || 0} publicaciones</span><span class="quotaPill">${plan.searches || 0} búsquedas</span></div>
          <div class="timelineNote">Podrás operar durante ${plan.days} días con ${plan.publications || 0} publicaciones y ${plan.searches || 0} búsquedas completas disponibles.</div>
          <div class="priceDisclaimer">Precio de venta sin IVA.</div>
          <div class="planFoot"><span class="planBadge">Contratación por tiempo</span><button class="btn btn-primary" type="button" data-plan="${plan.code}">Agregar al carrito</button></div>
        </div>`).join('');
      document.querySelectorAll('[data-plan]').forEach((btn)=> btn.onclick = ()=> addPlan(btn.dataset.plan));
    }

    function renderCart(){
      const count = state.cart.reduce((acc, it)=> acc + it.quantity, 0);
      document.getElementById('cartCount').textContent = `${count} ítem${count===1?'':'s'}`;
      const q = state.quote || { subtotal:0, discountAmount:0, vatAmount:0, total:0, totalDays:0, totalPublications:0, totalOpenings:0, coupon:{message:''} };
      if(!state.cart.length){
        document.getElementById('cartItems').innerHTML = '<div class="emptyStateFactory" style="margin-top:14px">Todavía no agregaste planes.</div>';
        document.getElementById('cartTotals').innerHTML = '<div class="cartLine"><span>Subtotal</span><b>$0</b></div><div class="cartLine total"><span>Total</span><b>$0</b></div>';
        document.getElementById('couponMsg').textContent = state.couponFeedback || 'Ingresá un código de bonificación para intentar aplicarlo al total.';
        document.getElementById('checkoutCouponMsg').textContent = state.couponFeedback || 'Si el código es válido, el total se recalcula automáticamente.';
        return;
      }
      document.getElementById('cartItems').innerHTML = state.cart.map((row)=> { const plan = planByCode(row.planCode) || { name: row.planCode, days:0, price:0, publications:0, searches:0 }; return `
        <div class="cartItem"><div class="cartItemHead"><div><div style="font-weight:900;font-size:18px">${esc(plan.name)}</div><div class="muted">${plan.days} días · ${plan.publications || 0} publicaciones · ${plan.searches || 0} búsquedas</div></div><button class="btn btn-ghost" type="button" data-remove="${plan.code}">Quitar</button></div><div class="rowBetween" style="margin-top:14px"><div class="qtyPill"><button type="button" data-qty="${plan.code}" data-delta="-1">−</button><b>${row.quantity}</b><button type="button" data-qty="${plan.code}" data-delta="1">+</button></div><div style="font-size:24px;font-weight:950">${money(plan.price * row.quantity)}</div></div></div>`; }).join('');
      document.querySelectorAll('[data-remove]').forEach((btn)=> btn.onclick = ()=> removeFromCart(btn.dataset.remove));
      document.querySelectorAll('[data-qty]').forEach((btn)=> btn.onclick = ()=> changeQty(btn.dataset.qty, Number(btn.dataset.delta || 0)));
      document.getElementById('couponMsg').textContent = state.couponFeedback || q.coupon?.message || 'Ingresá un código de bonificación para intentar aplicarlo al total.';
      document.getElementById('checkoutCouponMsg').textContent = state.couponFeedback || q.coupon?.message || 'Si el código es válido, el total se recalcula automáticamente.';
      document.getElementById('cartTotals').innerHTML = `
        <div class="cartLine"><span>Subtotal</span><b>${money(q.subtotal)}</b></div>
        <div class="cartLine"><span>Bonificaciones</span><b>${money(q.discountAmount)}</b></div>
        <div class="cartLine"><span>IVA (21%)</span><b>${money(q.vatAmount)}</b></div>
        <div class="cartLine"><span>Días acumulados</span><b>${q.totalDays || 0}</b></div>
        <div class="cartLine"><span>Publicaciones acumuladas</span><b>${q.totalPublications || 0}</b></div>
        <div class="cartLine"><span>Búsquedas acumuladas</span><b>${q.totalOpenings || 0}</b></div>
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
      const q = state.quote || { items: [], subtotal:0, discountAmount:0, vatAmount:0, total:0, totalDays:0, totalPublications:0, totalOpenings:0 };
      document.getElementById('cardAmount').value = money(q.total || 0);
      document.getElementById('checkoutItems').innerHTML = (q.items || []).map((it)=> `<div class="cartItem" style="margin-top:0;margin-bottom:12px"><div style="font-weight:900">${esc(it.planName)}</div><div class="muted">${it.quantity} unidad(es) · ${it.days} días · ${it.publicationsPerUnit || 0} publicaciones · ${it.searchesPerUnit || 0} búsquedas</div><div style="margin-top:8px;font-size:22px;font-weight:950">${money(it.subtotal)}</div></div>`).join('') || '<div class="emptyStateFactory">Todavía no hay items en el resumen.</div>';
      document.getElementById('checkoutTotals').innerHTML = `
        <div class="cartLine"><span>Subtotal</span><b>${money(q.subtotal || 0)}</b></div>
        <div class="cartLine"><span>Bonificaciones</span><b>${money(q.discountAmount || 0)}</b></div>
        <div class="cartLine"><span>IVA (21%)</span><b>${money(q.vatAmount || 0)}</b></div>
        <div class="cartLine"><span>Publicaciones</span><b>${q.totalPublications || 0}</b></div>
        <div class="cartLine"><span>Búsquedas</span><b>${q.totalOpenings || 0}</b></div>
        <div class="cartLine total"><span>Total</span><b>${money(q.total || 0)}</b></div>
        <div class="priceDisclaimer" style="margin-top:4px">El precio base del plan no incluye IVA; el total ya lo suma automáticamente.</div>`;
    }

    async function loadAdminBootstrap(){
      try{ state.adminBootstrap = await apiFactory('/factory/admin/bootstrap', {}, true); }
      catch(e){ document.getElementById('adminUnlockMsg').textContent = e.message; return; }
      fillAdminSelectors();
      renderAdminPlans();
      renderAdminLists();
      await loadAdminOrders();
    }

    function fillAdminSelectors(){
      const companies = state.adminBootstrap?.companies || [];
      const optsAny = ['<option value="">Cualquier empresa</option>'].concat(companies.map((c)=> `<option value="${c.id}">${esc(c.companyName)}${c.cuit ? ' · ' + esc(c.cuit) : ''}</option>`));
      document.getElementById('adminCouponCompany').innerHTML = optsAny.join('');
      const optsReq = ['<option value="">Seleccioná empresa</option>'].concat(companies.map((c)=> `<option value="${c.id}">${esc(c.companyName)}${c.cuit ? ' · ' + esc(c.cuit) : ''}</option>`));
      document.getElementById('adminAccessCompany').innerHTML = optsReq.join('');
      document.getElementById('adminCouponPct').innerHTML = Array.from({length:10}, (_,i)=> (i+1)*10).map((v)=> `<option value="${v}">${v}%</option>`).join('');
      document.getElementById('adminAccessMonth').innerHTML = monthChoices().map((m)=> `<option value="${m.value}">${esc(m.label)}</option>`).join('');
    }

    function renderAdminPlans(){
      const rows = state.adminBootstrap?.plans || [];
      document.getElementById('adminPlanRows').innerHTML = rows.map((plan)=> `<tr><td><input class="input" data-plan-field="name" data-code="${plan.code}" value="${esc(plan.name)}" /></td><td><input class="input" type="number" min="1" step="1" inputmode="numeric" data-plan-field="days" data-code="${plan.code}" value="${plan.days}" /></td><td><input class="input" type="number" min="0" step="1000" inputmode="numeric" data-plan-field="price" data-code="${plan.code}" value="${plan.price}" /></td><td><input class="input" type="number" min="0" step="1" inputmode="numeric" data-plan-field="publications" data-code="${plan.code}" value="${plan.publications || 0}" /></td><td><input class="input" type="number" min="0" step="1" inputmode="numeric" data-plan-field="searches" data-code="${plan.code}" value="${plan.searches || 0}" /></td></tr>`).join('');
    }

    function renderAdminLists(){
      const coupons = state.adminBootstrap?.coupons || [];
      document.getElementById('adminCouponsList').innerHTML = coupons.length ? coupons.slice(0,20).map((c)=> `<div style="padding:8px 0;border-bottom:1px solid var(--tp-border)"><b>${esc(c.code)}</b> · ${c.grantsFullAccess ? 'Acceso total' : esc((c.discountPct||0) + '%')} ${c.companyId ? '· empresa específica' : '· uso abierto'}</div>`).join('') : 'Sin códigos cargados todavía.';
      const grants = state.adminBootstrap?.grants || [];
      document.getElementById('adminGrantsList').innerHTML = grants.length ? grants.slice(0,20).map((g)=> `<div style="padding:8px 0;border-bottom:1px solid var(--tp-border)"><b>${esc(g.company?.companyName || 'Empresa')}</b> · ${esc(g.code)} · hasta ${when(g.fullAccessUntil)}</div>`).join('') : 'Sin accesos especiales vigentes.';
    }

    async function loadAdminOrders(){
      const list = document.getElementById('adminList');
      list.innerHTML = '<div class="emptyStateFactory">Cargando panel administrador…</div>';
      try{
        const params = new URLSearchParams({ q: document.getElementById('adminSearch').value.trim(), days: document.getElementById('adminDays').value, sort: document.getElementById('adminSort').value });
        const data = await apiFactory('/factory/admin/orders?' + params.toString(), {}, true);
        state.adminItems = data.items || [];
        if(!state.adminItems.length){ list.innerHTML = '<div class="emptyStateFactory">Todavía no hay compras registradas para mostrar.</div>'; return; }
        list.innerHTML = state.adminItems.map((group)=> `<details class="adminCompanyGroup"><summary>${esc(group.companyName)} <span class="muted monoData">· ${esc(group.companyCode || '')}</span></summary><div class="factoryTableWrap" style="margin-top:12px"><table class="factoryTable" style="min-width:720px"><thead><tr><th>Documento</th><th>Fecha</th><th>Días</th><th>Estado</th><th>Total</th></tr></thead><tbody>${(group.documents || []).map((doc)=> `<tr><td>${esc(doc.documentNo)}</td><td>${when(doc.date)}</td><td>${doc.days || 0}</td><td><span class="statusPill ${esc(doc.status)}">${esc(statusLabel(doc.status))}</span></td><td>${money(doc.totals.total)}</td></tr>`).join('')}</tbody></table></div></details>`).join('');
      }catch(e){ list.innerHTML = `<div class="emptyStateFactory">${esc(e.message)}</div>`; }
    }

    async function renderAdminSection(){ if(state.bootstrap?.adminUnlocked && !state.adminBootstrap) await loadAdminBootstrap(); updateAdminVisibility(); }

    document.getElementById('btnUnlockAdmin').onclick = async ()=> {
      const alias = document.getElementById('factoryAdminAlias').value.trim();
      const password = document.getElementById('factoryAdminPassword').value.trim();
      document.getElementById('adminUnlockMsg').textContent = 'Validando acceso…';
      try{
        state.adminAlias = alias;
        state.adminPassword = password;
        localStorage.setItem('tp_factory_admin_alias', alias);
        localStorage.setItem('tp_factory_admin_password', password);
        await apiFactory('/factory/admin/unlock', { method:'POST', body: JSON.stringify({ alias, password, key: password }) }, true);
        await loadBootstrap();
        document.getElementById('adminUnlockMsg').textContent = 'Acceso validado. Factory Admin habilitado.';
        setTab('admin');
      }catch(e){
        localStorage.removeItem('tp_factory_admin_alias');
        localStorage.removeItem('tp_factory_admin_password');
        state.adminAlias='';
        state.adminPassword='';
        document.getElementById('adminUnlockMsg').textContent = e.message;
      }
    };

    document.getElementById('btnSavePlans').onclick = async ()=> {
      const rows = Array.from(document.querySelectorAll('#adminPlanRows tr')).map((tr, idx)=> {
        const inputs = tr.querySelectorAll('[data-plan-field]');
        const get = (field)=> Array.from(inputs).find((el)=> el.dataset.planField === field)?.value || '';
        const code = inputs[0]?.dataset.code || `P${idx}`;
        return { code, name: get('name'), days: Number(get('days')||0), price: Number(get('price')||0), publications: Number(get('publications')||0), searches: Number(get('searches')||0) };
      });
      const msg = document.getElementById('adminPlanMsg'); msg.textContent = 'Guardando…';
      try{ await apiFactory('/factory/admin/plans', { method:'POST', body: JSON.stringify({ plans: rows }) }, true); msg.textContent='Matriz actualizada.'; state.adminBootstrap=null; await loadBootstrap(); await loadAdminBootstrap(); }
      catch(e){ msg.textContent=e.message; }
    };

    document.getElementById('btnCreateCoupon').onclick = async ()=> {
      const msg = document.getElementById('adminCouponMsg'); msg.textContent='Guardando…';
      try{
        await apiFactory('/factory/admin/coupons', { method:'POST', body: JSON.stringify({ code: document.getElementById('adminCouponCode').value.trim(), discountPct: Number(document.getElementById('adminCouponPct').value || 0), companyId: document.getElementById('adminCouponCompany').value || null }) }, true);
        msg.textContent='Código generado.'; document.getElementById('adminCouponCode').value=''; state.adminBootstrap=null; await loadAdminBootstrap();
      }catch(e){ msg.textContent=e.message; }
    };

    document.getElementById('btnCreateAccess').onclick = async ()=> {
      const msg = document.getElementById('adminAccessMsg'); msg.textContent='Generando…';
      try{
        await apiFactory('/factory/admin/full-access', { method:'POST', body: JSON.stringify({ code: document.getElementById('adminAccessCode').value.trim(), companyId: document.getElementById('adminAccessCompany').value, untilMonth: document.getElementById('adminAccessMonth').value }) }, true);
        msg.textContent='Código de acceso total creado.'; document.getElementById('adminAccessCode').value=''; state.adminBootstrap=null; await loadAdminBootstrap();
      }catch(e){ msg.textContent=e.message; }
    };

    document.getElementById('btnAdminRefresh').onclick = loadAdminOrders;
    document.getElementById('btnRedeemAccessCode').onclick = async ()=> {
      const code = document.getElementById('specialAccessCode').value.trim();
      const msg = document.getElementById('specialAccessMsg'); msg.textContent='Validando código…';
      try{ const data = await apiFactory('/factory/redeem-access-code', { method:'POST', body: JSON.stringify({ code }) }); msg.textContent = data.message || 'Acceso especial activado.'; document.getElementById('specialAccessCode').value=''; await loadBootstrap(); }
      catch(e){ msg.textContent = e.message; }
    };

    document.getElementById('btnApplyCoupon').onclick = ()=> applyCouponCode(document.getElementById('couponCode').value);
    document.getElementById('btnApplyCheckoutCoupon').onclick = ()=> applyCouponCode(document.getElementById('checkoutCouponCode').value);
    document.getElementById('btnContinueShopping').onclick = ()=> setTab('plans');
    document.getElementById('btnOpenCheckout').onclick = ()=> { if(!state.cart.length){ document.getElementById('couponMsg').textContent = 'Primero agregá al menos un plan.'; return; } clearCheckoutResult(); setTab('plans'); document.getElementById('checkoutCard').style.display=''; prefillCheckout(); renderCheckout(); document.getElementById('checkoutCard').scrollIntoView({ behavior:'smooth', block:'start' }); };
    document.getElementById('btnBackToCart').onclick = ()=> { clearCheckoutResult(); document.getElementById('checkoutCard').style.display='none'; window.scrollTo({ top:0, behavior:'smooth' }); };
    document.getElementById('btnCheckoutConfirm').onclick = async ()=> {
      const msg = document.getElementById('checkoutMsg'); msg.textContent='Autorizando pago virtual…';
      try{
        const payload = { items: getQuoteItems(), couponCode: state.couponCode, billing: { razonSocial: document.getElementById('billingName').value.trim(), cuit: document.getElementById('billingTaxId').value.trim(), condicionFiscal: document.getElementById('billingTaxCondition').value.trim(), provincia: document.getElementById('billingProvince').value.trim(), localidad: document.getElementById('billingCity').value.trim(), calle: document.getElementById('billingStreet').value.trim(), numero: document.getElementById('billingNumber').value.trim(), piso: document.getElementById('billingFloor').value.trim(), depto: document.getElementById('billingDept').value.trim(), codigoPostal: document.getElementById('billingPostalCode').value.trim(), email: document.getElementById('billingEmail').value.trim() }, payment: { cardNumber: document.getElementById('cardNumber').value.trim(), cardHolder: document.getElementById('cardHolder').value.trim(), cardHolderDni: document.getElementById('cardHolderDni').value.trim(), cardBrand: document.getElementById('cardBrand').value.trim(), expiry: document.getElementById('cardExpiry').value.trim(), cvv: document.getElementById('cardCvv').value.trim() } };
        const data = await apiFactory('/factory/checkout', { method:'POST', body: JSON.stringify(payload) });
        msg.textContent = data.message || 'Compra virtual aprobada.';
        state.cart=[]; saveCart(); state.couponCode=''; state.couponFeedback=''; localStorage.removeItem('tp_factory_coupon');
        state.selectedOrderId = data.order?.id || null;
        if(state.bootstrap){
          state.bootstrap.orders = [data.order, ...(state.bootstrap.orders || [])];
          state.bootstrap.totals = {
            total: Number(state.bootstrap.totals?.total || 0) + Number(data.order?.totals?.total || 0),
            pending: Number(state.bootstrap.totals?.pending || 0),
            paid: Number(state.bootstrap.totals?.paid || 0) + Number(data.order?.totals?.total || 0),
            orders: Number(state.bootstrap.totals?.orders || 0) + 1,
          };
          state.bootstrap.operationUsage = data.operationUsage || state.bootstrap.operationUsage;
          state.bootstrap.openingUsage = data.operationUsage || state.bootstrap.openingUsage;
        }
        renderSummary();
        renderCart();
        showCheckoutResult(data);
      }catch(e){ msg.textContent = e.message; }
    };

    loadBootstrap().catch((e)=> {
      document.getElementById('summaryBadge').textContent = e.message;
      document.getElementById('ordersBody').innerHTML = `<tr><td colspan="9"><div class="emptyStateFactory">${esc(e.message)}</div></td></tr>`;
    });
  