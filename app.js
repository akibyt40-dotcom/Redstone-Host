const $ = s => document.querySelector(s);
const authView=$("#authView"), appView=$("#appView"), toastEl=$("#toast"), pageContent=$("#pageContent");
let currentUser=null, allPlans=[], term="monthly";
function toast(msg){toastEl.textContent=msg;toastEl.classList.add("show");setTimeout(()=>toastEl.classList.remove("show"),3500)}
async function api(url,opts={}){const r=await fetch(url,{...opts,headers:{"Content-Type":"application/json",...(opts.headers||{})}});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||"Request failed");return data}
function setAuth(user){currentUser=user;authView.classList.add("hidden");appView.classList.remove("hidden");$("#userTag").textContent=`Welcome back, ${user.username}!`;$("#adminNav").classList.toggle("hidden",user.role!=="admin");$("#adminsNav").classList.toggle("hidden",user.role!=="admin");go("dashboard")}
function showLogin(){ $("#loginForm").classList.remove("hidden");$("#registerForm").classList.add("hidden");}
$("#showRegister").onclick=e=>{e.preventDefault();$("#loginForm").classList.add("hidden");$("#registerForm").classList.remove("hidden")};
$("#showLogin").onclick=e=>{e.preventDefault();showLogin()};
function updateLoginButton(){const ready=$("#identity").value.trim()&&$("#password").value.length>0;$("#loginBtn").disabled=!ready;$("#loginBtn").classList.toggle("ready",!!ready)}
$("#identity").addEventListener("input",updateLoginButton);$("#password").addEventListener("input",updateLoginButton);
$("#loginForm").addEventListener("submit",async e=>{e.preventDefault();try{const d=await api("/api/login",{method:"POST",body:JSON.stringify({identity:$("#identity").value,password:$("#password").value})});setAuth(d.user)}catch(err){toast(err.message)}});
$("#registerForm").addEventListener("submit",async e=>{e.preventDefault();try{const d=await api("/api/register",{method:"POST",body:JSON.stringify({username:$("#regUsername").value,email:$("#regEmail").value,password:$("#regPassword").value})});setAuth(d.user)}catch(err){toast(err.message)}});
$("#logoutBtn").onclick=async()=>{await api("/api/logout",{method:"POST"});currentUser=null;appView.classList.add("hidden");authView.classList.remove("hidden");showLogin()};
$("#discordBtn").onclick=()=>toast("Discord sign-in needs OAuth credentials and callback setup.");
document.querySelectorAll(".nav").forEach(b=>b.addEventListener("click",()=>go(b.dataset.page)));
async function go(page){document.querySelectorAll(".nav").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
pageContent.classList.remove("page-enter");void pageContent.offsetWidth;pageContent.classList.add("page-enter");
if(page==="dashboard")return dashboard();if(page==="servers")return servers();if(page==="plans")return renderPlans();if(page==="billing")return billing();if(page==="tickets")return tickets();if(page==="support")return simple("Support","Contact the Redstone Host support team for help with orders and hosting.");if(page==="settings")return simple("Settings","Account settings will be expanded in a later release.");if(page==="admin")return adminOrders();if(page==="admins")return adminCreateServers();}
function simple(title,body){pageContent.innerHTML=`<div class="hero"><h1>${title}</h1><p>${body}</p></div>`}
async function dashboard(){const [s,o]=await Promise.all([api("/api/servers"),api("/api/orders")]);pageContent.innerHTML=`<div class="hero"><h1>Welcome back, ${esc(currentUser.username)}!</h1><p>Manage your hosting journey from here.</p></div><div class="grid"><div class="stat">Total Servers<strong>${s.servers.length}</strong></div><div class="stat">Active Servers<strong>${s.servers.filter(x=>x.status==="Online").length}</strong></div><div class="stat">Orders<strong>${o.orders.length}</strong></div></div><div class="section-title"><h2>Quick Actions</h2></div><div class="quick"><button class="btn primary" onclick="go('plans')">Browse Plans</button><button class="btn" onclick="go('servers')">My Servers</button><button class="btn" onclick="go('billing')">View Orders</button></div>`}
async function servers(){const d=await api("/api/servers");pageContent.innerHTML=`<div class="section-title"><div><h2>My Servers</h2><p class="muted">Servers are added after admin approval and manual setup.</p></div><span class="badge">Manual setup only</span></div>${d.servers.length?`<div class="panel"><table class="table"><tr><th>Name</th><th>Plan</th><th>RAM</th><th>Status</th></tr>${d.servers.map(s=>`<tr><td>${esc(s.name)}</td><td>${esc(s.plan_id)}</td><td>${s.ram_gb} GB</td><td>${esc(s.status)}</td></tr>`).join("")}</table></div>`:`<div class="panel empty"><h2>No Servers Found!</h2><p>You haven't received a server yet.</p><button class="btn primary" style="max-width:220px" onclick="go('plans')">Browse Plans</button></div>`}`}
async function renderPlans(){const d=await api("/api/plans");allPlans=d.plans;pageContent.innerHTML=`<div class="section-title"><div><h2>Our Plans</h2><p class="muted">Choose the perfect plan for your Minecraft server.</p></div><div class="toggle"><button class="btn ${term==='monthly'?'primary':''}" onclick="setTerm('monthly')">Monthly</button><button class="btn ${term==='quarterly'?'primary':''}" onclick="setTerm('quarterly')">Quarterly</button></div></div><div class="plan-grid">${allPlans.map(p=>`<article class="plan ${p.id==='gold'?'featured':''}"><h3>${p.name}</h3><div class="ram">${p.ram} GB RAM</div><p class="muted">Minecraft Hosting</p><ul><li>Manual server setup</li><li>Plan support</li><li>Server details after approval</li></ul><div class="price">${p.id==='stone'?'FREE/12MIN':(p.price===0?'FREE':'৳'+(p.price*(term==='quarterly'?3:1))+'<small class=\"muted\">/'+(term==='monthly'?'mo':'3 months')+'</small>')}</div><button class="btn" onclick="orderPlan('${p.id}')">${p.price===0?'Request Free Plan':'Buy Now'}</button></article>`).join("")}</div><p class="muted tiny">Quarterly is billed at 3× the monthly price in this initial version; no discount is applied.</p>`}
window.setTerm=t=>{term=t;renderPlans()};
window.orderPlan=async id=>{try{const d=await api("/api/orders",{method:"POST",body:JSON.stringify({planId:id,term})});toast(`Ticket #${d.ticketId} created. Message the admin for payment instructions.`);go("tickets");openTicket(d.ticketId)}catch(e){toast(e.message)}};
async function billing(){const d=await api("/api/orders");pageContent.innerHTML=`<div class="section-title"><h2>Billing & Orders</h2></div><div class="panel">${d.orders.length?`<table class="table"><tr><th>Order</th><th>Plan</th><th>Term</th><th>Amount</th><th>Status</th></tr>${d.orders.map(o=>`<tr><td>#${o.id}</td><td>${esc(o.plan_id)}</td><td>${o.term}</td><td>৳${o.amount}</td><td><span class="badge">${o.status}</span></td></tr>`).join("")}</table>`:`<div class="empty">No orders yet.</div>`}</div>`}

async function tickets(){
 const d=await api("/api/tickets");
 pageContent.innerHTML=`<div class="section-title"><div><h2>My Tickets</h2><p class="muted">Deploy requests, payment instructions and server setup are handled here.</p></div></div>
 <div class="panel">${d.tickets.length?d.tickets.map(t=>`<div class="ticket-row"><div><b>Ticket #${t.id} · ${esc(t.subject)}</b><p class="muted">Plan: ${esc(t.plan_id)} · Amount: ৳${t.amount} · Status: ${esc(t.status)}</p></div><button class="btn" onclick="openTicket(${t.id})">Open Ticket</button></div>`).join(""):`<div class="empty">No tickets yet. Choose a plan and press Deploy.</div>`}</div>`;
}
window.openTicket=async id=>{
 try{
  const d=await api(`/api/tickets/${id}/messages`);
  pageContent.innerHTML=`<div class="section-title"><div><h2>Ticket #${id}</h2><p class="muted">${esc(d.ticket.subject)} · Status: ${esc(d.ticket.status)}</p></div><button class="btn" onclick="go('tickets')">Back to Tickets</button></div>
  <div class="panel"><div class="ticket-messages">${d.messages.map(m=>`<div class="ticket-message ${m.sender_role==='admin'?'admin-message':''}"><b>${esc(m.username)} · ${m.sender_role==='admin'?'Admin':'Customer'}</b><p>${esc(m.message)}</p><small>${esc(m.created_at)}</small></div>`).join("")}</div>
  <form id="ticketReplyForm" class="ticket-reply"><textarea id="ticketReply" maxlength="2000" placeholder="Write your message... (Ask how to pay, send transaction ID, or reply to admin)" required></textarea><button class="btn primary" type="submit">Send Message</button></form></div>`;
  $("#ticketReplyForm").onsubmit=async e=>{e.preventDefault();try{await api(`/api/tickets/${id}/messages`,{method:"POST",body:JSON.stringify({message:$("#ticketReply").value})});openTicket(id)}catch(err){toast(err.message)}};
 }catch(e){toast(e.message)}
};
async function adminTickets(){
 if(currentUser.role!=="admin")return toast("Not allowed.");
 const d=await api("/api/admin/tickets");
 pageContent.innerHTML=`<div class="section-title"><div><h2>Customer Tickets</h2><p class="muted">Reply with payment method and instructions. Verify payment before marking paid or approving the order.</p></div></div>
 <div class="panel">${d.tickets.length?d.tickets.map(t=>`<div class="ticket-row"><div><b>#${t.id} · ${esc(t.username)} · ${esc(t.plan_id)}</b><p class="muted">৳${t.amount} · ${esc(t.status)} · Order ${t.order_status}</p></div><button class="btn" onclick="adminOpenTicket(${t.id})">View & Reply</button></div>`).join(""):`<div class="empty">No customer tickets.</div>`}</div>`;
}
window.adminOpenTicket=async id=>{
 try{
  const d=await api(`/api/tickets/${id}/messages`);
  pageContent.innerHTML=`<div class="section-title"><div><h2>Admin · Ticket #${id}</h2><p class="muted">${esc(d.ticket.subject)}</p></div><button class="btn" onclick="adminTickets()">Back</button></div>
  <div class="panel"><div class="ticket-messages">${d.messages.map(m=>`<div class="ticket-message ${m.sender_role==='admin'?'admin-message':''}"><b>${esc(m.username)} · ${m.sender_role==='admin'?'Admin':'Customer'}</b><p>${esc(m.message)}</p><small>${esc(m.created_at)}</small></div>`).join("")}</div>
  <form id="adminTicketReply" class="ticket-reply"><textarea id="adminReplyText" maxlength="2000" placeholder="Reply with payment instructions, payment confirmation, or server setup update..." required></textarea><button class="btn primary" type="submit">Send Reply</button></form>
  <div class="ticket-actions"><button class="btn" onclick="ticketStatus(${id},'waiting_customer')">Waiting for Customer</button><button class="btn" onclick="ticketStatus(${id},'paid')">Mark Paid</button><button class="btn" onclick="ticketStatus(${id},'approved')">Approved</button><button class="btn" onclick="ticketStatus(${id},'closed')">Close Ticket</button></div></div>`;
  $("#adminTicketReply").onsubmit=async e=>{e.preventDefault();try{await api(`/api/tickets/${id}/messages`,{method:"POST",body:JSON.stringify({message:$("#adminReplyText").value})});adminOpenTicket(id)}catch(err){toast(err.message)}};
 }catch(e){toast(e.message)}
};
window.ticketStatus=async(id,status)=>{try{await api(`/api/admin/tickets/${id}/status`,{method:"POST",body:JSON.stringify({status})});toast("Ticket status updated.");adminOpenTicket(id)}catch(e){toast(e.message)}};
async function adminOrders(){if(currentUser.role!=="admin")return toast("Not allowed.");const d=await api("/api/admin/orders");pageContent.innerHTML=`<div class="section-title"><div><h2>Order Requests</h2><button class="btn" onclick="adminTickets()">Customer Tickets</button><p class="muted">Approve only after verifying payment. Approval creates a pending record, not a live game server.</p></div></div><div class="panel">${d.orders.length?`<table class="table"><tr><th>User</th><th>Plan</th><th>Term</th><th>Amount</th><th>Status</th><th>Action</th></tr>${d.orders.map(o=>`<tr><td>${esc(o.username)}<br><small>${esc(o.email)}</small></td><td>${esc(o.plan_id)}</td><td>${o.term}</td><td>৳${o.amount}</td><td>${o.status}</td><td>${o.status==='pending'?`<button class="btn" onclick="approve(${o.id})">Approve</button> <button class="btn" onclick="reject(${o.id})">Reject</button>`:'—'}</td></tr>`).join("")}</table>`:`<div class="empty">No order requests.</div>`}</div>`}
window.approve=async id=>{const name=prompt("Server display name (server will remain pending manual setup):","Minecraft Server");if(name===null)return;try{const d=await api(`/api/admin/orders/${id}/approve`,{method:"POST",body:JSON.stringify({serverName:name})});toast(d.message);adminOrders()}catch(e){toast(e.message)}};
window.reject=async id=>{try{await api(`/api/admin/orders/${id}/reject`,{method:"POST"});toast("Order rejected.");adminOrders()}catch(e){toast(e.message)}};
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
(async()=>{try{const d=await api("/api/me");if(d.user)setAuth(d.user)}catch{}})();


async function adminCreateServers(){
 if(currentUser.role!=="admin")return toast("Not allowed.");
 const d=await api("/api/admin/servers");
 pageContent.innerHTML=`<div class="hero"><h1>⚙ Admins · Create Servers</h1><p>Create a server record and assign it to an existing user by email or username. VPS deployment will be connected later.</p></div>
 <div class="panel admin-create-panel"><div class="section-title"><div><h2>Create Server</h2><p class="muted">Enter the server name and the account that will own it.</p></div><span class="badge">Admin only</span></div>
 <form id="createServerForm" class="admin-server-form">
 <label for="adminServerName">Server Name</label><input id="adminServerName" maxlength="40" placeholder="e.g. Survival SMP" required>
 <label for="adminServerOwner">Server Owner Email or Username</label><input id="adminServerOwner" placeholder="Enter registered user's email or username" required>
 <div class="admin-form-grid"><div><label for="adminServerVersion">Server Versions</label><select id="adminServerVersion" disabled><option>Will be added after VPS setup</option></select></div><div><label for="adminServerSoftware">Server Software</label><select id="adminServerSoftware" disabled><option>Will be added after VPS setup</option></select></div></div>
 <p class="muted tiny">Version and software selection are intentionally disabled for now; they will be connected when the VPS is ready.</p>
 <button class="btn primary" type="submit">＋ Create Server</button></form></div>
 <div class="section-title"><div><h2>Recently Created Servers</h2><p class="muted">These are records only; no Minecraft process is started yet.</p></div></div>
 <div class="panel">${d.servers.length?`<table class="table"><tr><th>Server</th><th>Owner</th><th>Version</th><th>Software</th><th>Status</th></tr>${d.servers.map(v=>`<tr><td>${esc(v.name)}</td><td>${esc(v.username)}<br><small>${esc(v.email)}</small></td><td>${esc(v.server_version||'Not set')}</td><td>${esc(v.software||'Not set')}</td><td><span class="badge">${esc(v.status)}</span></td></tr>`).join("")}</table>`:`<div class="empty">No admin-created servers yet.</div>`}</div>`;
 $("#createServerForm").onsubmit=async e=>{e.preventDefault();const btn=e.submitter;btn.disabled=true;try{const result=await api("/api/admin/servers",{method:"POST",body:JSON.stringify({serverName:$("#adminServerName").value,ownerIdentity:$("#adminServerOwner").value})});toast(`Server record #${result.serverId} created for ${result.owner.username}. VPS setup is still pending.`);adminCreateServers()}catch(err){toast(err.message);btn.disabled=false}};
}