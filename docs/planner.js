"use strict";
// Planeador de viagens: combina percursos a pé com os autocarros do dia
// (algoritmo do tipo RAPTOR: cada ronda acrescenta mais um autocarro).
(function (global) {
  const WALK_M_PER_MIN = 75;  // ~4,5 km/h
  const DETOUR = 1.3;         // as ruas não são em linha reta
  const MAX_ACCESS = 1200;    // distância máxima (em linha reta) a pé até/desde uma paragem
  const MAX_TRANSFER = 400;   // distância máxima a pé ao mudar de autocarro
  const MAX_RIDES = 3;
  const TRANSFER_BUFFER = 2;  // minutos de folga ao mudar de autocarro (os autocarros podem atrasar-se)

  function distance(lat1, lon1, lat2, lon2) {
    const r = Math.PI / 180, a = Math.sin((lat2 - lat1) * r / 2) ** 2 +
      Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon1) * r / 2) ** 2;
    return 12742000 * Math.asin(Math.sqrt(a));
  }
  const walkMinutes = m => (m < 1 ? 0 : Math.max(1, Math.ceil(m * DETOUR / WALK_M_PER_MIN)));

  function createPlanner(D) {
    const n = D.stops.length;
    const tripId = new Map(D.trips.map((t, i) => [t, i]));
    const neighbors = D.stops.map((s, i) => {
      const list = [];
      D.stops.forEach((o, j) => {
        if (j === i) return;
        const dist = distance(s.lat, s.lon, o.lat, o.lon);
        if (dist <= MAX_TRANSFER) list.push({ j, dist, min: walkMinutes(dist) });
      });
      return list;
    });
    const near = (p, max) => {
      const out = [];
      D.stops.forEach((s, i) => {
        const dist = distance(p.lat, p.lon, s.lat, s.lon);
        if (dist <= max) out.push({ i, dist, min: walkMinutes(dist) });
      });
      return out;
    };

    // Uma pesquisa: melhores chegadas saindo a partir de t0, com 1, 2, ... autocarros.
    function search(trips, from, to, t0) {
      const access = near(from, MAX_ACCESS), egress = near(to, MAX_ACCESS);
      if (!access.length || !egress.length) return [];

      const rounds = [];
      const arr0 = new Array(n).fill(Infinity), par0 = new Array(n).fill(null);
      access.forEach(a => { arr0[a.i] = t0 + a.min; par0[a.i] = { type: "access", dist: a.dist, min: a.min }; });
      rounds.push({ arr: arr0, par: par0 });
      const best = arr0.slice(); // melhor chegada a cada paragem com qualquer número de autocarros

      for (let k = 1; k <= MAX_RIDES; k++) {
        const ready = rounds[k - 1].arr.map((a, s) => Math.min(a + (k > 1 ? TRANSFER_BUFFER : 0), best[s] + TRANSFER_BUFFER));
        if (k === 1) access.forEach(a => { ready[a.i] = arr0[a.i]; });
        const rideArr = new Array(n).fill(Infinity), ridePar = new Array(n).fill(null);
        for (const t of trips) {
          let board = -1;
          for (let p = 0; p < t.st.length; p += 2) {
            const s = t.st[p], time = t.st[p + 1];
            if (board >= 0 && time < rideArr[s]) { rideArr[s] = time; ridePar[s] = { type: "ride", trip: t, from: board, to: p }; }
            // Apanha o autocarro na última paragem possível: mesma chegada, menos tempo de espera.
            if (p < t.st.length - 2 && ready[s] <= time) board = p;
          }
        }
        const arr = rideArr.slice(), par = ridePar.slice();
        let any = false;
        for (let s = 0; s < n; s++) {
          if (rideArr[s] === Infinity) continue;
          any = true;
          for (const nb of neighbors[s]) {
            const t = rideArr[s] + nb.min;
            if (t < arr[nb.j]) { arr[nb.j] = t; par[nb.j] = { type: "transfer", from: s, dist: nb.dist, min: nb.min }; }
          }
        }
        rounds.push({ arr, par, rideArr, ridePar });
        arr.forEach((a, s) => { if (a < best[s]) best[s] = a; });
        if (!any) break;
      }

      // Melhor chegada ao destino para cada número de autocarros (só se melhorar com mais um).
      // Do destino conta-se a partir da paragem onde se sai do autocarro, sem transbordos a pé.
      const results = [];
      let bestTotal = Infinity;
      for (let k = 1; k < rounds.length; k++) {
        let pick = null;
        for (const e of egress) {
          const total = rounds[k].rideArr[e.i] + e.min;
          if (total < (pick ? pick.total : Infinity)) pick = { e, total };
        }
        if (pick && pick.total < bestTotal) {
          bestTotal = pick.total;
          results.push(build(rounds, k, pick.e));
        }
      }
      return results;
    }

    function build(rounds, k, e) {
      const legs = [{ type: "walk", from: e.i, to: null, dist: e.dist, min: e.min }];
      let s = e.i;
      let first = true;
      while (k > 0) {
        let p = first ? rounds[k].ridePar[s] : rounds[k].par[s];
        first = false;
        if (p.type === "transfer") {
          legs.unshift({ type: "walk", from: p.from, to: s, dist: p.dist, min: p.min });
          s = p.from;
          p = rounds[k].ridePar[s];
        }
        const boardStop = p.trip.st[p.from], boardTime = p.trip.st[p.from + 1];
        legs.unshift({ type: "ride", trip: p.trip, from: p.from, to: p.to });
        s = boardStop;
        let j = 0;
        while (j < k - 1 && !(rounds[j].arr[s] + (j > 0 ? TRANSFER_BUFFER : 0) <= boardTime)) j++;
        k = j;
      }
      const a = rounds[0].par[s];
      legs.unshift({ type: "walk", from: null, to: s, dist: a.dist, min: a.min });
      return finish(legs);
    }

    function finish(legs) {
      const rides = legs.filter(l => l.type === "ride");
      const first = rides[0], last = rides[rides.length - 1];
      const depart = first.trip.st[first.from + 1] - legs[0].min;
      const arrive = last.trip.st[last.to + 1] + legs[legs.length - 1].min;
      const walk = legs.filter(l => l.type === "walk").reduce((m, l) => m + l.min, 0);
      const key = rides.map(r => `${tripId.get(r.trip)}:${r.from}:${r.to}`).join("|");
      return { legs, depart, arrive, duration: arrive - depart, rides: rides.length, walk, key };
    }

    // Várias opções: repete a pesquisa a partir de cada partida encontrada.
    function plan(trips, from, to, t0, maxOptions = 4) {
      const walkDist = distance(from.lat, from.lon, to.lat, to.lon);
      const walkOnly = { dist: walkDist, min: walkMinutes(walkDist) };
      const found = new Map();
      let t = t0;
      for (let i = 0; i < 10 && found.size < maxOptions * 2; i++) {
        const res = search(trips, from, to, t);
        if (!res.length) break;
        res.forEach(r => { if (!found.has(r.key)) found.set(r.key, r); });
        t = Math.min(...res.map(r => r.depart)) + 1;
      }
      let options = [...found.values()]
        // Sem sentido: andar mais do que a viagem toda a pé, ou chegar depois de ir a pé numa viagem curta.
        .filter(o => o.walk < walkOnly.min && !(walkOnly.min <= 20 && o.arrive >= t0 + walkOnly.min));
      // Retira opções que não acrescentam nada a uma melhor já escolhida: chegam ao mesmo tempo
      // ou mais tarde, com tantos ou mais autocarros, a pé mais ou menos o mesmo e a sair à mesma hora.
      options.sort((a, b) => a.arrive - b.arrive || a.rides - b.rides || a.walk - b.walk || b.depart - a.depart);
      const kept = [];
      for (const o of options) {
        if (!kept.some(b => b.arrive <= o.arrive && b.rides <= o.rides && b.walk <= o.walk + 3 && b.depart >= o.depart - 5)) kept.push(o);
      }
      const noStopsNear = !near(from, MAX_ACCESS).length ? "from" : !near(to, MAX_ACCESS).length ? "to" : null;
      return { options: kept.slice(0, maxOptions), walkOnly, noStopsNear };
    }

    return { plan, nearestStopDistance: p => Math.min(...D.stops.map(s => distance(p.lat, p.lon, s.lat, s.lon))) };
  }

  global.createPlanner = createPlanner;
  global.plannerDistance = distance;
})(typeof window !== "undefined" ? window : globalThis);
