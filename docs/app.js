"use strict";
(() => {
  const D = window.GTFS;
  const planner = window.createPlanner(D);
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
  const fmtDuration = m => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`);
  const ymd = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromYmd = s => new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
  const fmtDate = (d, opts) => d.toLocaleDateString("pt-PT", opts);
  const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const nowMinutes = () => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); };

  const distance = window.plannerDistance;
  const fmtDist = m => m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(1).replace(".", ",")} km`;

  const ICON = {
    walk: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M13.5 5.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM9.8 8.9 7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3A7.3 7.3 0 0 0 19 13v-2a5 5 0 0 1-4.3-2.4l-1-1.6a2 2 0 0 0-2.5-.8L6 8.3V13h2V9.6l1.8-.7"/></svg>',
    pin: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Z"/></svg>',
    gps: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm9 3h-2.07A7 7 0 0 0 13 5.07V3h-2v2.07A7 7 0 0 0 5.07 11H3v2h2.07A7 7 0 0 0 11 18.93V21h2v-2.07A7 7 0 0 0 18.93 13H21v-2Zm-9 6a5 5 0 1 1 0-10 5 5 0 0 1 0 10Z"/></svg>',
    swap: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16 17.01V10h-2v7.01h-3L15 21l4-3.99h-3ZM9 3 5 6.99h3V14h2V6.99h3L9 3Z"/></svg>',
  };

  // ---------- Horários ----------
  function serviceRuns(id, date) {
    const s = D.services[id];
    if (!s) return false;
    const key = ymd(date);
    if (s.removed.includes(key)) return false;
    if (s.added.includes(key)) return true;
    return key >= s.start && key <= s.end && s.days[(date.getDay() + 6) % 7] === 1;
  }

  const MY_LOCATION = { kind: "gps", label: "A minha localização" };
  const state = {
    date: startOfToday(), view: "home", route: null, stop: null, showAll: false, userPos: null,
    from: MY_LOCATION, to: null, whenMode: "now", whenTime: "", selected: 0, picking: null, plan: null,
  };
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
  const stopPoint = i => ({ kind: "stop", label: D.stops[i].label, lat: D.stops[i].lat, lon: D.stops[i].lon });

  // ---------- Mapa ----------
  const map = L.map("map", { zoomControl: false, renderer: L.canvas({ tolerance: 6 }) });
  L.control.zoom({ position: "topright" }).addTo(map);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  map.createPane("plan").style.zIndex = 440;
  map.createPane("stops").style.zIndex = 450;
  const stopRenderer = L.canvas({ pane: "stops", tolerance: 8 });

  const routeLayers = D.routes.map((r, i) => {
    const group = L.featureGroup();
    r.shapes.forEach(pts => {
      L.polyline(pts, { color: "#1a1a1a", weight: 8, opacity: .3, casing: true, interactive: false }).addTo(group);
      L.polyline(pts, { color: r.color, weight: 5, opacity: 1 }).addTo(group);
    });
    group.on("click", () => { if (!state.picking) location.hash = routeHref(i); });
    return group.addTo(map);
  });

  const stopMarkers = D.stops.map((s, i) => L.circleMarker([s.lat, s.lon], {
    renderer: stopRenderer, radius: 5, color: "#1a1a1a", weight: 2, fillColor: "#ffffff", fillOpacity: 1, bubblingMouseEvents: false,
  }).bindTooltip(s.label, { direction: "top", offset: [0, -6] })
    .on("click", () => {
      if (state.picking) setPoint(state.picking, stopPoint(i));
      else location.hash = stopHref(i);
    })
    .addTo(map));

  const allBounds = L.latLngBounds(D.stops.map(s => [s.lat, s.lon]));
  map.fitBounds(allBounds, { padding: [20, 20] });

  let userMarker = null;
  const planLayer = L.featureGroup().addTo(map);
  const planRenderer = L.svg({ pane: "plan" });
  const pinLayer = L.layerGroup().addTo(map);
  const pinIcon = kind => L.divIcon({ className: `mpin mpin-${kind}`, iconSize: kind === "to" ? [26, 26] : [18, 18], iconAnchor: kind === "to" ? [13, 26] : [9, 9] });

  function drawPins() {
    pinLayer.clearLayers();
    for (const which of ["from", "to"]) {
      const p = state[which];
      if (p && p.lat != null && !(which === "from" && p.kind === "gps" && userMarker))
        L.marker([p.lat, p.lon], { icon: pinIcon(which), interactive: false, keyboard: false }).addTo(pinLayer);
    }
  }

  function styleMap() {
    const r = state.view === "route" ? state.route : null;
    const trip = state.view === "trip";
    routeLayers.forEach((layer, i) => {
      const on = !trip && (r === null || r === i);
      layer.eachLayer(l => l.setStyle(l.options.casing ? { opacity: on ? .3 : 0 } : { opacity: on ? 1 : trip ? .12 : .2 }));
    });
    if (r !== null) routeLayers[r].bringToFront();
    stopMarkers.forEach((m, i) => {
      const selected = state.view === "stop" && state.stop === i;
      const dim = trip || (r !== null && !stopRoutes[i].has(r));
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

  // Índice do ponto do traçado mais perto de (lat, lon), a partir de `start`.
  function nearestIndex(shape, lat, lon, start) {
    let best = start, bestD = Infinity;
    for (let i = start; i < shape.length; i++) {
      const d = (shape[i][0] - lat) ** 2 + ((shape[i][1] - lon) * 0.76) ** 2;
      if (d < bestD) { bestD = d; best = i; }
      else if (bestD < 4e-7 && d > bestD * 4) break; // já passou pela paragem
    }
    return best;
  }

  // Troço do traçado percorrido entre a paragem onde se entra e a paragem onde se sai.
  function rideGeometry(leg) {
    const t = leg.trip, stops = [];
    for (let p = 0; p <= leg.to; p += 2) stops.push(D.stops[t.st[p]]);
    const shape = D.routes[t.r].shapes[t.sh];
    const ends = [stops[leg.from / 2], stops[stops.length - 1]];
    if (!shape) return stops.slice(leg.from / 2).map(s => [s.lat, s.lon]);
    let idx = 0, i0 = 0;
    stops.forEach((s, k) => {
      idx = nearestIndex(shape, s.lat, s.lon, idx);
      if (k === leg.from / 2) i0 = idx;
    });
    return [[ends[0].lat, ends[0].lon], ...shape.slice(i0, idx + 1), [ends[1].lat, ends[1].lon]];
  }

  // ---------- Percursos a pé pelas ruas (OSRM do OpenStreetMap, gratuito) ----------
  // O planeador estima os tempos a pé pela distância em linha reta. Para as opções mostradas
  // vai-se buscar o percurso real pelas ruas, que é o que se desenha e se mostra no passo a passo.
  const walkCache = new Map();
  const stopLL = i => [D.stops[i].lat, D.stops[i].lon];
  const legEnds = leg => [leg.from === null ? [state.from.lat, state.from.lon] : stopLL(leg.from),
                          leg.to === null ? [state.to.lat, state.to.lon] : stopLL(leg.to)];
  const llKey = ([a, b]) => `${a[1].toFixed(5)},${a[0].toFixed(5)};${b[1].toFixed(5)},${b[0].toFixed(5)}`;

  function walkRoute(leg) {
    const key = llKey(legEnds(leg));
    if (walkCache.has(key)) return walkCache.get(key);
    const entry = { done: false, data: null };
    walkCache.set(key, entry);
    const attempt = tries => fetch(`https://routing.openstreetmap.de/routed-foot/route/v1/foot/${key}?overview=full&geometries=geojson`)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(res.status))))
      .then(j => {
        const r = j.routes && j.routes[0];
        if (r) entry.data = { coords: r.geometry.coordinates.map(([lon, lat]) => [lat, lon]), dist: r.distance, min: Math.max(1, Math.ceil(r.distance / 75)) };
      })
      // Uma nova tentativa passado um bocado; se voltar a falhar fica a estimativa.
      .catch(() => (tries < 2 ? new Promise(ok => setTimeout(ok, 1500)).then(() => attempt(tries + 1)) : null));
    attempt(1).finally(() => { entry.done = true; if (state.view === "trip") render(false); });
    return entry;
  }
  // Distância e minutos a pé de um troço: o percurso real se já chegou, senão a estimativa.
  function walkInfo(leg) {
    const e = walkCache.get(llKey(legEnds(leg)));
    return e && e.data ? { dist: e.data.dist, min: e.data.min, real: true } : { dist: leg.dist * 1.3, min: leg.min, real: false };
  }
  function timing(o) {
    const rides = o.legs.filter(l => l.type === "ride"), first = rides[0], last = rides[rides.length - 1];
    const depart = first.trip.st[first.from + 1] - walkInfo(o.legs[0]).min;
    const arrive = last.trip.st[last.to + 1] + walkInfo(o.legs[o.legs.length - 1]).min;
    return { depart, arrive, duration: arrive - depart };
  }

  function drawPlan(option) {
    planLayer.clearLayers();
    if (!option) return;
    for (const leg of option.legs) {
      if (leg.type === "walk") {
        if (leg.min === 0) continue;
        const ends = legEnds(leg), route = walkRoute(leg);
        const pts = route.data ? [ends[0], ...route.data.coords, ends[1]] : ends;
        L.polyline(pts, { renderer: planRenderer, color: "#3b3f3d", weight: 4, dashArray: "1 9", lineCap: "round", opacity: route.done ? 1 : .4, interactive: false }).addTo(planLayer);
        continue;
      }
      const pts = rideGeometry(leg), color = D.routes[leg.trip.r].color;
      L.polyline(pts, { renderer: planRenderer, color: "#1a1a1a", weight: 10, opacity: .35, interactive: false }).addTo(planLayer);
      L.polyline(pts, { renderer: planRenderer, color, weight: 6, interactive: false }).addTo(planLayer);
      for (const p of [leg.from, leg.to]) {
        L.circleMarker(stopLL(leg.trip.st[p]), { renderer: planRenderer, radius: 7, weight: 3, color: "#1a1a1a", fillColor: "#ffffff", fillOpacity: 1, interactive: false }).addTo(planLayer);
      }
    }
  }

  // ---------- Localização ----------
  function locate() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error("Este dispositivo não permite obter a localização."));
      navigator.geolocation.getCurrentPosition(pos => {
        state.userPos = [pos.coords.latitude, pos.coords.longitude];
        if (userMarker) userMarker.setLatLng(state.userPos);
        else userMarker = L.circleMarker(state.userPos, { radius: 8, color: "#ffffff", weight: 3, fillColor: "#1a73e8", fillOpacity: 1, interactive: false }).addTo(map);
        resolve(state.userPos);
      }, () => reject(new Error("Não foi possível obter a sua localização.")), { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
    });
  }
  const farFromGuarda = (lat, lon) => planner.nearestStopDistance({ lat, lon }) > 15000;

  // ---------- Pesquisa de moradas e locais (Photon, baseado no OpenStreetMap) ----------
  const CENTER = allBounds.getCenter();
  const BBOX = [allBounds.getWest() - .06, allBounds.getSouth() - .06, allBounds.getEast() + .06, allBounds.getNorth() + .06].map(n => n.toFixed(4)).join(",");
  const placeLabel = p => p.name || [p.street, p.housenumber].filter(Boolean).join(" ");

  async function geocode(q, signal) {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lat=${CENTER.lat.toFixed(4)}&lon=${CENTER.lng.toFixed(4)}&bbox=${BBOX}`;
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error("geocode");
    const seen = new Set();
    return (await res.json()).features.map(f => {
      const p = f.properties, label = placeLabel(p);
      const sub = [p.name && p.street ? [p.street, p.housenumber].filter(Boolean).join(" ") : null, p.district || p.locality, p.city]
        .filter((x, i, a) => x && a.indexOf(x) === i && x !== label).join(", ");
      return { kind: "place", label, sub, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] };
    }).filter(x => x.label && !seen.has(x.label + x.sub) && seen.add(x.label + x.sub));
  }

  async function reverseLabel(point) {
    try {
      const res = await fetch(`https://photon.komoot.io/reverse?lat=${point.lat.toFixed(5)}&lon=${point.lon.toFixed(5)}&limit=1`);
      const f = (await res.json()).features[0];
      const label = f && placeLabel(f.properties);
      if (label && distance(point.lat, point.lon, f.geometry.coordinates[1], f.geometry.coordinates[0]) < 150) {
        point.label = `Perto de ${label}`;
        if (state.from === point || state.to === point) render(false);
      }
    } catch { /* fica "Ponto no mapa" */ }
  }

  // ---------- Planeamento ----------
  const pointHash = p => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
  const tripHash = () => `#viagem/${pointHash(state.from)}/${pointHash(state.to)}`;

  function setPoint(which, point) {
    state[which] = point;
    stopPicking();
    if (point.kind === "map") reverseLabel(point);
    drawPins();
    if (state.from && state.to) startPlan();
    else render(false);
  }

  async function startPlan() {
    if (!state.to) { showToast("Escolhe primeiro o destino."); return; }
    if (!state.from) { showToast("Escolhe o ponto de partida."); return; }
    if (state.from.kind === "gps") {
      try {
        const [lat, lon] = await locate();
        if (farFromGuarda(lat, lon)) {
          state.from = null;
          showToast("Parece que não estás na Guarda. Escolhe o ponto de partida.", 6000);
          if (state.view === "home") render(false); else location.hash = "#";
          return;
        }
        state.from = { ...MY_LOCATION, lat, lon };
      } catch (e) {
        state.from = null;
        showToast(e.message + " Escolhe o ponto de partida.", 6000);
        if (state.view === "home") render(false); else location.hash = "#";
        return;
      }
    }
    state.selected = 0;
    drawPins();
    const hash = tripHash();
    if (location.hash === hash) render(true); else location.hash = hash;
  }

  function startPicking(which) {
    state.picking = which;
    map.getContainer().classList.add("picking");
    showToast(which === "from" ? "Toca no mapa no ponto de partida." : "Toca no mapa no destino.", 8000);
    if (window.matchMedia("(max-width: 760px)").matches) $(".mapwrap").scrollIntoView({ behavior: "smooth" });
  }
  function stopPicking() {
    state.picking = null;
    map.getContainer().classList.remove("picking");
    hideToast();
  }
  map.on("click", e => {
    if (state.picking) setPoint(state.picking, { kind: "map", label: "Ponto no mapa", lat: e.latlng.lat, lon: e.latlng.lng });
  });

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
      Os horários podem sofrer alterações. Os tempos a pé são aproximados.
      Pesquisa de moradas: <a href="https://photon.komoot.io" target="_blank" rel="noopener">Photon</a>;
      percursos a pé: <a href="https://routing.openstreetmap.de" target="_blank" rel="noopener">OSRM / FOSSGIS</a> (OpenStreetMap).</p>`;
  }

  function plannerForm() {
    const val = p => (p ? esc(p.label) : "");
    return `<form id="planner" class="planner" autocomplete="off">
      <div class="pfield"><span class="pin pin-from" aria-hidden="true"></span>
        <input id="fromInput" type="search" placeholder="De onde?" aria-label="Partida" value="${val(state.from)}">
        <button type="button" class="iconbtn" data-pick="from" title="Escolher a partida no mapa" aria-label="Escolher a partida no mapa">${ICON.pin}</button></div>
      <div class="pfield"><span class="pin pin-to" aria-hidden="true"></span>
        <input id="toInput" type="search" placeholder="Para onde vais?" aria-label="Destino" value="${val(state.to)}">
        <button type="button" class="iconbtn" data-pick="to" title="Escolher o destino no mapa" aria-label="Escolher o destino no mapa">${ICON.pin}</button></div>
      <ul id="suggest" class="list suggest" hidden></ul>
      <div class="prow">
        <select id="whenMode" aria-label="Hora de partida">
          <option value="now"${state.whenMode === "now" ? " selected" : ""}>Sair agora</option>
          <option value="at"${state.whenMode === "at" ? " selected" : ""}>Sair às…</option>
        </select>
        <input id="whenTime" type="time" aria-label="Hora" value="${esc(state.whenTime)}"${state.whenMode === "at" ? "" : " hidden"}>
        <button type="submit" class="primary">Ver opções</button>
      </div>
    </form>`;
  }

  function bindPlanner() {
    const form = $("#planner"), list = $("#suggest");
    let items = [], field = null, ctrl = null, timer = null;

    const show = () => {
      list.hidden = !items.length;
      list.innerHTML = items.map((it, k) => `<li><button type="button" data-k="${k}">
        <span class="sicon">${it.kind === "gps" ? ICON.gps : it.kind === "stop" ? '<span class="stopdot"></span>' : ICON.pin}</span>
        <span class="text"><strong>${esc(it.label)}</strong>${it.sub ? `<small>${esc(it.sub)}</small>` : ""}</span></button></li>`).join("");
    };
    const suggest = (which, q) => {
      field = which;
      const term = fold(q.trim());
      const base = which === "from" ? [{ ...MY_LOCATION }] : [];
      const seen = new Set();
      const stops = term.length < 2 ? [] : D.stops.map((s, i) => i)
        .filter(i => D.stops[i].key.includes(term) && !seen.has(D.stops[i].key) && seen.add(D.stops[i].key)).slice(0, 4)
        .map(i => ({ ...stopPoint(i), sub: "Paragem · " + routesOf(i).map(r => D.routes[r].short).join(", ") }));
      items = [...base, ...stops];
      show();
      clearTimeout(timer);
      if (ctrl) ctrl.abort();
      if (term.length < 3) return;
      timer = setTimeout(async () => {
        ctrl = new AbortController();
        try {
          const places = await geocode(q.trim(), ctrl.signal);
          if (field === which) { items = [...base, ...stops, ...places]; show(); }
        } catch { /* sem rede ou pedido cancelado */ }
      }, 350);
    };
    const choose = it => {
      items = []; show();
      const { sub, ...point } = it;
      setPoint(field, point);
    };

    for (const which of ["from", "to"]) {
      const input = $(`#${which}Input`);
      input.addEventListener("input", () => { state[which] = null; drawPins(); suggest(which, input.value); });
      input.addEventListener("focus", () => { input.select(); suggest(which, state[which] ? "" : input.value); });
      input.addEventListener("keydown", e => { if (e.key === "Escape") { items = []; show(); } });
    }
    list.addEventListener("click", e => {
      const b = e.target.closest("button[data-k]");
      if (b) choose(items[+b.dataset.k]);
    });
    form.addEventListener("click", e => {
      const b = e.target.closest("[data-pick]");
      if (b) { items = []; show(); startPicking(b.dataset.pick); }
    });
    const whenMode = $("#whenMode"), whenTime = $("#whenTime");
    whenMode.addEventListener("change", () => {
      state.whenMode = whenMode.value;
      whenTime.hidden = state.whenMode !== "at";
      if (state.whenMode === "at" && !whenTime.value) whenTime.value = state.whenTime = fmtTime(nowMinutes());
    });
    whenTime.addEventListener("change", () => { state.whenTime = whenTime.value; });
    form.addEventListener("submit", e => {
      e.preventDefault();
      // Se escreveu o destino mas não escolheu da lista, usa a primeira sugestão.
      const first = items.find(it => it.kind !== "gps");
      if (field && !state[field] && first) return choose(first);
      startPlan();
    });
  }

  function renderHome() {
    panel.innerHTML = `
      ${dateNotice()}
      ${plannerForm()}
      <h3 class="section">Paragens</h3>
      <div class="search"><input id="q" type="search" placeholder="Procurar paragem…" autocomplete="off" aria-label="Procurar paragem"></div>
      <ul id="results" class="list"></ul>
      <h3 class="section">Linhas</h3>
      <ul class="list">${D.routes.map((r, i) => {
        const heads = [...new Set(D.trips.filter(t => t.r === i).map(t => t.h))].slice(0, 4);
        return `<li><a href="${routeHref(i)}">${badge(i)}<span class="text"><strong>Linha ${esc(r.label)}</strong>
          <small>${esc(heads.join(" · "))}</small></span></a></li>`;
      }).join("")}</ul>
      ${credits()}`;
    bindPlanner();
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
      <div class="actions">
        <button class="linkbtn" id="goHere" type="button">${ICON.pin} Ir para aqui</button>
        ${opp !== null ? `<a class="linkbtn" href="${stopHref(opp)}">${ICON.swap} Paragem do outro lado da rua</a>` : ""}
      </div>
      <h3>${isToday() && !state.showAll ? "Próximos autocarros" : "Horários de " + esc(dayLabel())}</h3>
      ${body}
      ${toggle}`;
    const btn = $("#toggleAll");
    if (btn) btn.addEventListener("click", () => { state.showAll = !state.showAll; renderStop(i); });
    $("#goHere").addEventListener("click", () => {
      if (!state.from) state.from = MY_LOCATION;
      setPoint("to", stopPoint(i));
    });
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

  // ---------- Viagem: opções e passo a passo ----------
  const startMinutes = () => {
    if (state.whenMode === "at" && state.whenTime) { const [h, m] = state.whenTime.split(":").map(Number); return h * 60 + m; }
    return nowMinutes();
  };
  const liveNow = () => isToday() && state.whenMode === "now";

  function legSummary(o) {
    return o.legs.filter(l => l.type === "ride" || l.min > 0).map(l => l.type === "walk"
      ? `<span class="walk">${ICON.walk}${walkInfo(l).min}</span>`
      : badge(l.trip.r)).join('<span class="sep">›</span>');
  }
  function leaveText(o) {
    const extra = o.rides > 1 ? ` · ${o.rides - 1} transbordo${o.rides > 2 ? "s" : ""}` : "";
    const { depart } = timing(o);
    if (!liveNow()) return `Sai às ${fmtTime(depart)}${extra}`;
    const w = depart - nowMinutes();
    return `${w <= 0 ? "Sai já" : `Sai daqui a ${fmtDuration(w)}`}${extra}`;
  }

  function walkStep(l, target) {
    const w = walkInfo(l);
    return `<li class="step"><span class="sicon">${ICON.walk}</span><div>Anda <strong>${fmtDuration(w.min)}</strong> (${fmtDist(w.dist)}) até ${target}</div></li>`;
  }

  function steps(o) {
    const out = [], tm = timing(o);
    let clock = tm.depart, firstRide = true;
    o.legs.forEach(l => {
      if (l.type === "walk") {
        clock += walkInfo(l).min;
        if (l.min === 0) return;
        out.push(walkStep(l, l.to === null ? "ao destino" : `à paragem <a href="${stopHref(l.to)}">${esc(D.stops[l.to].label)}</a>`));
        return;
      }
      const t = l.trip, board = t.st[l.from + 1], alight = t.st[l.to + 1], wait = board - clock;
      const s0 = t.st[l.from], s1 = t.st[l.to], n = (l.to - l.from) / 2;
      const note = firstRide ? ""
        : wait < 1 ? ` <span class="warn">Ligação apertada: pode não dar tempo</span>`
        : wait > 1 ? ` <span class="muted small">(espera ${wait} min)</span>` : "";
      out.push(`<li class="step ride" style="--c:${D.routes[t.r].color}">${badge(t.r)}<div>
        <div>Apanha às <strong>${fmtTime(board)}</strong> em <a href="${stopHref(s0)}">${esc(D.stops[s0].label)}</a>${note}</div>
        <div class="muted small">Autocarro para ${esc(t.h)} · ${n} ${n > 1 ? "paragens" : "paragem"} · ${alight - board} min</div>
        <div>Sai às <strong>${fmtTime(alight)}</strong> em <a href="${stopHref(s1)}">${esc(D.stops[s1].label)}</a></div></div></li>`);
      clock = alight;
      firstRide = false;
    });
    out.push(`<li class="step"><span class="sicon"><span class="pin pin-to"></span></span><div>Chegas às <strong>${fmtTime(tm.arrive)}</strong> a ${esc(state.to.label)}</div></li>`);
    return `<ol class="steps">${out.join("")}</ol>`;
  }

  function renderTrip(moveMap) {
    const t0 = startMinutes();
    const { options: found, walkOnly, noStopsNear } = planner.plan(activeTrips(), state.from, state.to, t0);
    const canWalk = walkOnly.min <= 90;
    // "Ir a pé" tratado como uma opção com um único troço a pé.
    const walkOpt = { legs: [{ type: "walk", from: null, to: null, dist: walkOnly.dist, min: walkOnly.min }] };
    // Pede os percursos a pé reais de todas as opções (ficam em cache).
    [...found, ...(canWalk ? [walkOpt] : [])].forEach(o => o.legs.forEach(l => { if (l.type === "walk" && l.min > 0) walkRoute(l); }));
    const walk = walkInfo(walkOpt.legs[0]);
    // Com os tempos reais, esconde opções em que se anda quase tanto como a viagem toda a pé.
    const walkTotal = o => o.legs.reduce((m, l) => m + (l.type === "walk" ? walkInfo(l).min : 0), 0);
    // Também esconde as que, com o tempo a pé real, já obrigariam a ter saído antes da hora pedida.
    const options = found.filter(o => timing(o).depart >= t0 && (!canWalk || walkTotal(o) < walk.min * 0.8));
    const noBusText = noStopsNear
      ? `Não há paragens de autocarro a menos de 15 min a pé ${noStopsNear === "from" ? "do ponto de partida" : "do destino"}.`
      : found.length ? "Para esta viagem compensa ir a pé."
      : `Não encontrámos autocarros para esta viagem ${onDay()} a partir das ${fmtTime(t0)}.`;
    const choices = [...options.map((o, i) => i), ...(canWalk ? ["walk"] : [])];
    if (!choices.includes(state.selected)) state.selected = choices[0] ?? null;
    const sel = state.selected === "walk" ? walkOpt : options[state.selected] || null;

    const cards = options.map((o, i) => {
      const tm = timing(o);
      return `<button type="button" class="opt" data-opt="${i}" aria-pressed="${state.selected === i}">
        <span class="opt-top"><strong>${fmtTime(tm.depart)} → ${fmtTime(tm.arrive)}</strong><span>${fmtDuration(tm.duration)}</span></span>
        <span class="opt-legs">${legSummary(o)}</span>
        <span class="opt-sub">${leaveText(o)}</span></button>`;
    });
    if (canWalk) cards.push(`<button type="button" class="opt" data-opt="walk" aria-pressed="${state.selected === "walk"}">
        <span class="opt-top"><strong>${ICON.walk} Ir a pé</strong><span>${fmtDuration(walk.min)}</span></span>
        <span class="opt-sub">${fmtDist(walk.dist)} · chegas às ${fmtTime(t0 + walk.min)}</span></button>`);

    const when = state.whenMode === "at" && state.whenTime ? `Saída às ${fmtTime(t0)}` : "Saída agora";
    let detail = "";
    if (sel === walkOpt) detail = `<ol class="steps">${walkStep(walkOpt.legs[0], "ao destino")}
      <li class="step"><span class="sicon"><span class="pin pin-to"></span></span><div>Chegas às <strong>${fmtTime(t0 + walk.min)}</strong></div></li></ol>`;
    else if (sel) detail = steps(sel);

    panel.innerHTML = `<a class="back" href="#">← Alterar viagem</a>
      ${dateNotice()}
      <div class="od">
        <div><span class="pin pin-from"></span>${esc(state.from.label)}</div>
        <div><span class="pin pin-to"></span>${esc(state.to.label)}</div>
      </div>
      <p class="muted small">${when} · ${esc(dayLabel())}</p>
      ${options.length ? "" : `<p class="notice">${noBusText}</p>`}
      <div class="opts">${cards.join("")}</div>
      ${detail ? `<h3>Passo a passo</h3>${detail}` : ""}`;

    panel.querySelectorAll("[data-opt]").forEach(b => b.addEventListener("click", () => {
      state.selected = b.dataset.opt === "walk" ? "walk" : +b.dataset.opt;
      render(true);
    }));
    drawPlan(sel);
    if (moveMap) {
      const b = L.latLngBounds([[state.from.lat, state.from.lon], [state.to.lat, state.to.lon]]);
      if (planLayer.getLayers().length) b.extend(planLayer.getBounds());
      map.fitBounds(b, { padding: [40, 40], maxZoom: 17 });
    }
  }

  // ---------- Navegação (pelo endereço, para se poder partilhar links) ----------
  function parsePoint(text, label) {
    const [lat, lon] = (text || "").split(",").map(Number);
    return Number.isFinite(lat) && Number.isFinite(lon) ? { kind: "map", label, lat, lon } : null;
  }
  const samePoint = (a, b) => a && b && a.lat != null && Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lon - b.lon) < 1e-5;

  function render(moveMap) {
    const parts = location.hash.slice(1).split("/").map(decodeURIComponent);
    const [kind, id] = parts;
    const r = kind === "linha" ? D.routes.findIndex(x => x.short === id) : -1;
    const s = kind === "paragem" ? D.stops.findIndex(x => x.id === id) : -1;
    if (kind === "viagem") {
      const f = parsePoint(parts[1], "Origem"), t = parsePoint(parts[2], "Destino");
      if (f && t) {
        if (!samePoint(state.from, f)) state.from = f;
        if (!samePoint(state.to, t)) state.to = t;
        drawPins();
      }
    }
    const tripOk = kind === "viagem" && state.from && state.to && state.from.lat != null && state.to.lat != null;
    state.view = r >= 0 ? "route" : s >= 0 ? "stop" : tripOk ? "trip" : kind === "perto" && state.userPos ? "nearby" : "home";
    state.route = r >= 0 ? r : null;
    state.stop = s >= 0 ? s : null;

    // Mantém aberto o que estava aberto quando se volta a desenhar o mesmo ecrã.
    const open = new Set([...panel.querySelectorAll("details[open]")].map(d => d.dataset.key));
    const scroll = panel.scrollTop;
    if (state.view !== "trip") drawPlan(null);
    if (state.view === "route") renderRoute(r);
    else if (state.view === "stop") renderStop(s);
    else if (state.view === "trip") renderTrip(moveMap);
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

  window.addEventListener("hashchange", () => { state.showAll = false; state.selected = 0; stopPicking(); render(true); });

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

  // ---------- Avisos ----------
  const toast = $("#toast");
  let toastTimer;
  function showToast(msg, ms = 4000) {
    toast.textContent = msg;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, ms);
  }
  function hideToast() { clearTimeout(toastTimer); toast.hidden = true; }

  $("#locate").addEventListener("click", async () => {
    try {
      const pos = await locate();
      drawPins();
      map.setView(pos, 16);
      if (location.hash === "#perto") render(false); else location.hash = "#perto";
    } catch (e) { showToast(e.message); }
  });

  // Atualiza os "daqui a X min" a cada minuto.
  let lastMinute = nowMinutes();
  setInterval(() => {
    const live = state.view === "stop" || state.view === "route" || (state.view === "trip" && state.whenMode === "now");
    if (!isToday() || !live) return;
    const m = nowMinutes();
    if (m !== lastMinute) { lastMinute = m; render(false); }
  }, 15000);

  setDate(startOfToday());
  if (state.view !== "home") render(true);
})();
