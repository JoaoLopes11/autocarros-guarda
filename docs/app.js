"use strict";
(() => {
  const D = window.GTFS;
  const $ = sel => document.querySelector(sel);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  // ---------- Texto e datas ----------
  // Os nomes vêm em maiúsculas no GTFS; passam a "Av. Estação", mantendo as siglas.
  const ACRONYMS = new Set(["IPG", "PLIE", "TIR", "CMG", "EB23", "CBA", "GALP", "SACOR", "ULS", "X"]);
  const SMALL = new Set(["de", "do", "da", "dos", "das", "e"]);
  const nice = text => text.toLocaleLowerCase("pt").replace(/[\p{L}\p{N}.]+/gu, (w, offset) => {
    const up = w.toLocaleUpperCase("pt");
    if (ACRONYMS.has(up) || /^\p{L}\.\p{L}/u.test(w)) return up;
    if (offset > 0 && SMALL.has(w)) return w;
    return up[0] + w.slice(1);
  });
  const fold = s => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

  const pad = n => String(n).padStart(2, "0");
  const fmtTime = m => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
  const ymd = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromYmd = s => new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
  const fmtDate = (d, opts) => d.toLocaleDateString("pt-PT", opts);
  const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const nowMinutes = () => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); };

  function distance(lat1, lon1, lat2, lon2) {
    const r = Math.PI / 180, a = Math.sin((lat2 - lat1) * r / 2) ** 2 +
      Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon1) * r / 2) ** 2;
    return 12742000 * Math.asin(Math.sqrt(a));
  }
  const fmtDist = m => m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace(".", ",")} km`;

  // ---------- Horários ----------
  function serviceRuns(id, date) {
    const s = D.services[id];
    if (!s) return false;
    const key = ymd(date);
    if (s.removed.includes(key)) return false;
    if (s.added.includes(key)) return true;
    return key >= s.start && key <= s.end && s.days[(date.getDay() + 6) % 7] === 1;
  }

  const state = { date: startOfToday(), view: "home", route: null, stop: null, showAll: false, userPos: null };
  let cache = { key: null, trips: [] };
  const activeTrips = () => {
    const key = ymd(state.date);
    if (cache.key !== key) cache = { key, trips: D.trips.filter(t => serviceRuns(t.s, state.date)) };
    return cache.trips;
  };
  const isToday = () => ymd(state.date) === ymd(new Date());
  const inFeed = () => { const k = ymd(state.date); return k >= D.feed.start && k <= D.feed.end; };

  // ---------- Preparação dos dados ----------
  D.routes.forEach(r => { r.label = nice(r.name).replace(/^Linha /, ""); });
  D.trips.forEach(t => { t.h = nice(t.h); });
  D.stops.forEach(s => { s.label = nice(s.name); s.key = fold(s.name); });

  const stopRoutes = D.stops.map(() => new Set());
  const stopHeadsigns = D.stops.map(() => new Set());
  D.trips.forEach(t => {
    for (let i = 0; i < t.st.length; i += 2) {
      stopRoutes[t.st[i]].add(t.r);
      if (i < t.st.length - 2) stopHeadsigns[t.st[i]].add(t.h);
    }
  });
  const routesOf = i => [...stopRoutes[i]].sort((a, b) => a - b);

  // Paragem com o mesmo nome do outro lado da rua (sentido oposto).
  function oppositeStop(i) {
    const s = D.stops[i];
    let best = null, bestDist = 300;
    D.stops.forEach((o, j) => {
      if (j === i || o.key !== s.key) return;
      const d = distance(s.lat, s.lon, o.lat, o.lon);
      if (d < bestDist) { best = j; bestDist = d; }
    });
    return best;
  }

  const badge = (r, big) => `<span class="badge${big ? " big" : ""}" style="--c:${D.routes[r].color}">${esc(D.routes[r].short)}</span>`;
  const stopHref = i => `#paragem/${encodeURIComponent(D.stops[i].id)}`;
  const routeHref = r => `#linha/${encodeURIComponent(D.routes[r].short)}`;

  // ---------- Mapa ----------
  const map = L.map("map", { zoomControl: false, renderer: L.canvas({ tolerance: 6 }) });
  L.control.zoom({ position: "topright" }).addTo(map);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  map.createPane("stops").style.zIndex = 450;
  const stopRenderer = L.canvas({ pane: "stops", tolerance: 8 });

  const routeLayers = D.routes.map((r, i) => {
    const group = L.featureGroup();
    r.shapes.forEach(pts => {
      L.polyline(pts, { color: "#1a1a1a", weight: 8, opacity: .3, casing: true, interactive: false }).addTo(group);
      L.polyline(pts, { color: r.color, weight: 5, opacity: 1 }).addTo(group);
    });
    group.on("click", () => { location.hash = routeHref(i); });
    return group.addTo(map);
  });

  const stopMarkers = D.stops.map((s, i) => L.circleMarker([s.lat, s.lon], {
    renderer: stopRenderer, radius: 5, color: "#1a1a1a", weight: 2, fillColor: "#ffffff", fillOpacity: 1,
  }).bindTooltip(s.label, { direction: "top", offset: [0, -6] })
    .on("click", () => { location.hash = stopHref(i); })
    .addTo(map));

  let userMarker = null;
  map.fitBounds(L.latLngBounds(D.stops.map(s => [s.lat, s.lon])), { padding: [20, 20] });

  function styleMap() {
    const r = state.view === "route" ? state.route : null;
    routeLayers.forEach((layer, i) => {
      const on = r === null || r === i;
      layer.eachLayer(l => l.setStyle(l.options.casing ? { opacity: on ? .3 : 0 } : { opacity: on ? 1 : .2 }));
    });
    if (r !== null) routeLayers[r].bringToFront();
    stopMarkers.forEach((m, i) => {
      const selected = state.view === "stop" && state.stop === i;
      const dim = r !== null && !stopRoutes[i].has(r);
      m.setStyle(selected
        ? { radius: 9, weight: 3, fillColor: "#1f6f5c", color: "#ffffff", opacity: 1, fillOpacity: 1 }
        : { radius: dim ? 3 : 5, weight: 2, fillColor: "#ffffff", color: "#1a1a1a", opacity: dim ? .35 : 1, fillOpacity: dim ? .35 : 1 });
      if (selected) m.bringToFront();
    });
  }

  function showOnMap(latlng) {
    if (map.getZoom() < 15) map.setView(latlng, 16);
    else if (!map.getBounds().pad(-0.15).contains(latlng)) map.panTo(latlng);
  }

  // ---------- Painel ----------
  const panel = $("#panel");

  function dateNotice() {
    if (inFeed()) return "";
    return `<p class="notice">Não há horários para ${fmtDate(state.date, { day: "numeric", month: "long", year: "numeric" })}.
      Os horários disponíveis vão de ${fmtDate(fromYmd(D.feed.start), { day: "numeric", month: "long" })}
      a ${fmtDate(fromYmd(D.feed.end), { day: "numeric", month: "long", year: "numeric" })}.</p>`;
  }
  const dayLabel = () => isToday() ? "hoje" : fmtDate(state.date, { weekday: "long", day: "numeric", month: "long" });
  const onDay = () => isToday() ? "hoje" : "neste dia";

  function stopRow(i, extra = "") {
    const heads = [...stopHeadsigns[i]];
    return `<li><a href="${stopHref(i)}">
      <span class="text"><strong>${esc(D.stops[i].label)}</strong>
      <small>${routesOf(i).map(r => esc(D.routes[r].short)).join(", ")}${heads.length ? " · para " + esc(heads.join(", ")) : ""}</small></span>${extra}</a></li>`;
  }

  function credits() {
    return `<p class="credits">Horários: ${esc(nice(D.agency.name))}${D.agency.url ? ` (<a href="https://${esc(D.agency.url.replace(/^https?:\/\//i, "").toLowerCase())}" target="_blank" rel="noopener">${esc(D.agency.url.toLowerCase())}</a>)` : ""},
      válidos de ${fmtDate(fromYmd(D.feed.start), { day: "numeric", month: "long" })} a ${fmtDate(fromYmd(D.feed.end), { day: "numeric", month: "long", year: "numeric" })}.
      Os horários podem sofrer alterações.</p>`;
  }

  function renderHome() {
    panel.innerHTML = `
      ${dateNotice()}
      <p class="lead">Toca numa paragem ou numa linha para ver os horários.</p>
      <div class="search"><input id="q" type="search" placeholder="Procurar paragem…" autocomplete="off" aria-label="Procurar paragem"></div>
      <ul id="results" class="list"></ul>
      <h3 class="section">Linhas</h3>
      <ul class="list">${D.routes.map((r, i) => {
        const heads = [...new Set(D.trips.filter(t => t.r === i).map(t => t.h))].slice(0, 4);
        return `<li><a href="${routeHref(i)}">${badge(i)}<span class="text"><strong>Linha ${esc(r.label)}</strong>
          <small>${esc(heads.join(" · "))}</small></span></a></li>`;
      }).join("")}</ul>
      ${credits()}`;
    const q = $("#q"), results = $("#results");
    q.addEventListener("input", () => {
      const term = fold(q.value.trim());
      if (!term) { results.innerHTML = ""; return; }
      const found = D.stops.map((s, i) => i).filter(i => D.stops[i].key.includes(term)).slice(0, 12);
      results.innerHTML = found.length ? found.map(i => stopRow(i)).join("") : `<li class="muted small">Nenhuma paragem encontrada.</li>`;
    });
  }

  function renderNearby() {
    const [lat, lon] = state.userPos;
    const near = D.stops.map((s, i) => ({ i, d: distance(lat, lon, s.lat, s.lon) }))
      .sort((a, b) => a.d - b.d).slice(0, 8);
    panel.innerHTML = `<a class="back" href="#">← Início</a>
      <h2>Paragens perto de si</h2>
      <ul class="list">${near.map(n => stopRow(n.i, `<span class="dist">${fmtDist(n.d)}</span>`)).join("")}</ul>`;
  }

  function renderStop(i) {
    const s = D.stops[i];
    const deps = [];
    for (const t of activeTrips()) {
      for (let k = 0; k < t.st.length - 2; k += 2) if (t.st[k] === i) deps.push({ time: t.st[k + 1], t });
    }
    deps.sort((a, b) => a.time - b.time);
    const now = isToday() ? nowMinutes() : -1;
    const upcoming = deps.filter(d => d.time >= now);
    const list = state.showAll || !isToday() ? deps : upcoming.slice(0, 8);
    const opp = oppositeStop(i);

    const rows = list.map(d => {
      const wait = d.time - now;
      const soon = isToday() && wait >= 0 && wait < 60 ? `<span class="soon">${wait === 0 ? "agora" : `${wait} min`}</span>` : "";
      return `<li class="dep${d.time < now ? " past" : ""}"><time>${fmtTime(d.time)}</time>${badge(d.t.r)}
        <span class="dest">→ ${esc(d.t.h)}</span>${soon}</li>`;
    }).join("");

    let body;
    if (!deps.length) body = `<p class="muted">Não passam autocarros nesta paragem ${onDay()}.</p>`;
    else if (!list.length) body = `<p class="muted">Já não há mais autocarros hoje.</p>`;
    else body = `<ul class="deps">${rows}</ul>`;
    const toggle = isToday() && deps.length && (state.showAll || upcoming.length > list.length || upcoming.length < deps.length)
      ? `<button class="linkbtn" id="toggleAll" type="button">${state.showAll ? "Mostrar só os próximos" : "Ver todos os horários de hoje"}</button>` : "";

    panel.innerHTML = `<a class="back" href="#">← Início</a>
      ${dateNotice()}
      <h2>${esc(s.label)}</h2>
      ${s.code ? `<div class="muted small">Paragem n.º ${esc(s.code)}</div>` : ""}
      <div class="badges">${routesOf(i).map(r => `<a href="${routeHref(r)}">${badge(r)}</a>`).join("")}</div>
      ${opp !== null ? `<a class="linkbtn" href="${stopHref(opp)}">⇄ Paragem do outro lado da rua</a>` : ""}
      <h3>${isToday() && !state.showAll ? "Próximos autocarros" : "Horários de " + esc(dayLabel())}</h3>
      ${body}
      ${toggle}`;
    const btn = $("#toggleAll");
    if (btn) btn.addEventListener("click", () => { state.showAll = !state.showAll; renderStop(i); });
  }

  function renderRoute(r) {
    const route = D.routes[r];
    const all = D.trips.filter(t => t.r === r);
    const today = activeTrips().filter(t => t.r === r);
    const now = isToday() ? nowMinutes() : -1;

    const sections = [0, 1].map(dir => {
      const trips = all.filter(t => t.d === dir);
      if (!trips.length) return "";
      const counts = {};
      trips.forEach(t => { counts[t.h] = (counts[t.h] || 0) + 1; });
      const heads = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
      const longest = trips.reduce((a, b) => (b.st.length > a.st.length ? b : a));
      const runs = today.filter(t => t.d === dir);
      const next = runs.find(t => t.st[1] >= now);
      const times = runs.length
        ? `<div class="times">${runs.map(t => `<span class="${t === next && isToday() ? "next" : t.st[1] < now ? "past" : ""}"
            title="Parte de ${esc(D.stops[t.st[0]].label)} → ${esc(t.h)}">${fmtTime(t.st[1])}</span>`).join("")}</div>`
        : `<p class="muted small">Sem partidas ${onDay()}.</p>`;
      const stops = [];
      for (let k = 0; k < longest.st.length; k += 2) stops.push(longest.st[k]);
      return `<section>
        <h3>Para ${esc(heads.slice(0, 2).join(" / "))}</h3>
        <div class="muted small" style="margin-bottom:6px">Partidas do início da linha, ${esc(dayLabel())}:</div>
        ${times}
        <details data-key="dir${dir}"><summary>Paragens (${stops.length})</summary>
          <ol class="stops" style="--c:${route.color}">${stops.map(i => `<li><a href="${stopHref(i)}">${esc(D.stops[i].label)}</a></li>`).join("")}</ol>
        </details>
      </section>`;
    }).join("");

    panel.innerHTML = `<a class="back" href="#">← Início</a>
      ${dateNotice()}
      <div class="title">${badge(r, true)}<h2>Linha ${esc(route.label)}</h2></div>
      ${sections}`;
  }

  // ---------- Navegação (pelo endereço, para se poder partilhar links) ----------
  function render(moveMap) {
    const [kind, rawId] = location.hash.slice(1).split("/");
    const id = decodeURIComponent(rawId || "");
    const r = kind === "linha" ? D.routes.findIndex(x => x.short === id) : -1;
    const s = kind === "paragem" ? D.stops.findIndex(x => x.id === id) : -1;
    state.view = r >= 0 ? "route" : s >= 0 ? "stop" : kind === "perto" && state.userPos ? "nearby" : "home";
    state.route = r >= 0 ? r : null;
    state.stop = s >= 0 ? s : null;

    // Mantém aberto o que estava aberto quando se volta a desenhar o mesmo ecrã.
    const open = new Set([...panel.querySelectorAll("details[open]")].map(d => d.dataset.key));
    const scroll = panel.scrollTop;
    if (state.view === "route") renderRoute(r);
    else if (state.view === "stop") renderStop(s);
    else if (state.view === "nearby") renderNearby();
    else renderHome();
    if (!moveMap) {
      panel.querySelectorAll("details").forEach(d => { if (open.has(d.dataset.key)) d.open = true; });
      panel.scrollTop = scroll;
    } else panel.scrollTop = 0;

    document.querySelectorAll(".chip").forEach((c, i) => c.setAttribute("aria-current", String(state.route === i)));
    styleMap();
    if (moveMap) {
      if (state.view === "route") map.fitBounds(routeLayers[r].getBounds(), { padding: [30, 30] });
      if (state.view === "stop") showOnMap([D.stops[s].lat, D.stops[s].lon]);
    }
  }

  $("#lines").innerHTML = D.routes.map((r, i) =>
    `<a class="chip" href="${routeHref(i)}">${badge(i)}<span>${esc(r.label)}</span></a>`).join("");

  window.addEventListener("hashchange", () => { state.showAll = false; render(true); });

  // ---------- Data ----------
  const dateInput = $("#date"), todayBtn = $("#today");
  dateInput.min = isoDate(fromYmd(D.feed.start));
  dateInput.max = isoDate(fromYmd(D.feed.end));
  function setDate(d) {
    state.date = d;
    dateInput.value = isoDate(d);
    todayBtn.hidden = isToday();
    render(false);
  }
  dateInput.addEventListener("change", () => {
    if (!dateInput.value) return setDate(startOfToday());
    const [y, m, d] = dateInput.value.split("-").map(Number);
    setDate(new Date(y, m - 1, d));
  });
  todayBtn.addEventListener("click", () => setDate(startOfToday()));

  // ---------- Localização ----------
  const toast = $("#toast");
  let toastTimer;
  function showToast(msg) {
    toast.textContent = msg;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 4000);
  }
  $("#locate").addEventListener("click", () => {
    if (!navigator.geolocation) return showToast("Este dispositivo não permite obter a localização.");
    navigator.geolocation.getCurrentPosition(pos => {
      state.userPos = [pos.coords.latitude, pos.coords.longitude];
      if (userMarker) userMarker.setLatLng(state.userPos);
      else userMarker = L.circleMarker(state.userPos, { radius: 8, color: "#ffffff", weight: 3, fillColor: "#1a73e8", fillOpacity: 1, interactive: false }).addTo(map);
      map.setView(state.userPos, 16);
      if (location.hash === "#perto") render(false); else location.hash = "#perto";
    }, () => showToast("Não foi possível obter a sua localização."), { enableHighAccuracy: true, timeout: 10000 });
  });

  // Atualiza os "daqui a X min" a cada minuto.
  let lastMinute = nowMinutes();
  setInterval(() => {
    if (!isToday() || (state.view !== "stop" && state.view !== "route")) return;
    const m = nowMinutes();
    if (m !== lastMinute) { lastMinute = m; render(false); }
  }, 15000);

  setDate(startOfToday());
  if (state.view === "route" || state.view === "stop") render(true);
})();
