// Converte o feed GTFS (ficheiros .txt na pasta principal) em docs/data.js,
// o ficheiro de dados usado pelo mapa.
// Uso: node scripts/build-data.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const gtfsDir = process.argv[2] || root;

function parseCsv(text) {
  text = text.replace(/^﻿/, "");
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const [header, ...data] = rows;
  return data.map(r => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

const read = name => parseCsv(readFileSync(join(gtfsDir, `${name}.txt`), "utf8"));
const optional = name => { try { return read(name); } catch { return []; } };

const toMinutes = t => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const round5 = n => Math.round(n * 1e5) / 1e5;

// Douglas-Peucker: reduz os pontos dos traçados sem alterar a forma visível.
function simplify(points, tolerance) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a], [bx, by] = points[b];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    let maxDist = 0, index = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const ex = px - (ax + t * dx), ey = py - (ay + t * dy);
      const d = ex * ex + ey * ey;
      if (d > maxDist) { maxDist = d; index = i; }
    }
    if (maxDist > tolerance * tolerance) {
      keep[index] = 1;
      stack.push([a, index], [index, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const agency = read("agency")[0];
const feedInfo = optional("feed_info")[0] || {};
const routesCsv = read("routes");
const stopsCsv = read("stops");
const tripsCsv = read("trips");
const stopTimesCsv = read("stop_times");
const calendarCsv = optional("calendar");
const calendarDatesCsv = optional("calendar_dates");
const shapesCsv = optional("shapes");

// Paragens
const stopIndex = new Map();
const stops = stopsCsv.map((s, i) => {
  stopIndex.set(s.stop_id, i);
  return { id: s.stop_id, code: s.stop_code, name: s.stop_name.replace(/\s+/g, " ").trim(), lat: round5(+s.stop_lat), lon: round5(+s.stop_lon) };
});

// Traçados
const shapePoints = new Map();
for (const p of shapesCsv) {
  if (!shapePoints.has(p.shape_id)) shapePoints.set(p.shape_id, []);
  shapePoints.get(p.shape_id).push([+p.shape_pt_sequence, +p.shape_pt_lat, +p.shape_pt_lon]);
}
const shapes = new Map();
for (const [id, pts] of shapePoints) {
  pts.sort((a, b) => a[0] - b[0]);
  shapes.set(id, simplify(pts.map(p => [p[1], p[2]]), 0.00002).map(([la, lo]) => [round5(la), round5(lo)]));
}

// Serviços (dias em que cada horário funciona)
const services = {};
const service = id => (services[id] ??= { days: [0, 0, 0, 0, 0, 0, 0], start: "", end: "", added: [], removed: [] });
for (const c of calendarCsv) {
  const s = service(c.service_id);
  s.days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map(d => +c[d]);
  s.start = c.start_date;
  s.end = c.end_date;
}
for (const d of calendarDatesCsv) {
  const s = service(d.service_id);
  (d.exception_type === "1" ? s.added : s.removed).push(d.date);
}

// Horários de cada viagem
const timesByTrip = new Map();
for (const st of stopTimesCsv) {
  if (!timesByTrip.has(st.trip_id)) timesByTrip.set(st.trip_id, []);
  timesByTrip.get(st.trip_id).push(st);
}

const routeIndex = new Map();
const routes = routesCsv.map((r, i) => {
  routeIndex.set(r.route_id, i);
  return {
    id: r.route_id,
    short: r.route_short_name,
    name: r.route_long_name,
    color: "#" + (r.route_color || "3388ff").toLowerCase(),
    textColor: "#" + (r.route_text_color || "1a1a1a").toLowerCase(),
    shapes: [],
  };
});

const routeShapes = routes.map(() => new Set());
const trips = [];
for (const t of tripsCsv) {
  const r = routeIndex.get(t.route_id);
  const times = (timesByTrip.get(t.trip_id) || []).sort((a, b) => +a.stop_sequence - +b.stop_sequence);
  if (r === undefined || !times.length) continue;
  if (t.shape_id && shapes.has(t.shape_id)) routeShapes[r].add(t.shape_id);
  const st = [];
  for (const x of times) st.push(stopIndex.get(x.stop_id), toMinutes(x.departure_time || x.arrival_time));
  trips.push({ r, s: t.service_id, d: +(t.direction_id || 0), h: t.trip_headsign, st });
}
trips.sort((a, b) => a.st[1] - b.st[1]);
routes.forEach((route, i) => { route.shapes = [...routeShapes[i]].map(id => shapes.get(id)); });

const data = {
  agency: { name: agency.agency_name, url: agency.agency_url, phone: agency.agency_phone },
  feed: { start: feedInfo.feed_start_date || "", end: feedInfo.feed_end_date || "", version: feedInfo.feed_version || "" },
  routes, stops, services, trips,
};

const out = join(root, "docs", "data.js");
writeFileSync(out, "// Gerado por scripts/build-data.mjs a partir do feed GTFS. Não editar à mão.\nwindow.GTFS = " + JSON.stringify(data) + ";\n");
const points = routes.reduce((n, r) => n + r.shapes.reduce((m, s) => m + s.length, 0), 0);
console.log(`${routes.length} linhas, ${stops.length} paragens, ${trips.length} viagens, ${points} pontos de traçado -> ${out}`);
