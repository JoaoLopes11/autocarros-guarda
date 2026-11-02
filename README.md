# Autocarros da Guarda — mapa das linhas

Mapa web com as linhas, paragens e horários dos autocarros urbanos da Guarda, gerado a partir do feed GTFS da ETUG (os ficheiros `.txt` nesta pasta).

## Estrutura

- `*.txt`: feed GTFS original
- `scripts/build-data.mjs`: converte o GTFS em `docs/data.js`
- `scripts/serve.mjs`: servidor local para ver o site
- `docs/`: o site completo (é só esta pasta que se publica)
  - `docs/planner.js`: planeador de viagens (a pé + autocarro, com transbordos), calculado no próprio browser
  - a pesquisa de moradas usa o serviço gratuito [Photon](https://photon.komoot.io) (OpenStreetMap); os percursos e tempos a pé vêm do serviço gratuito [OSRM da FOSSGIS](https://routing.openstreetmap.de) (OpenStreetMap)

## Atualizar os horários

1. Substituir os ficheiros `.txt` pelos do novo feed GTFS.
2. Correr `node scripts/build-data.mjs`.
3. Publicar outra vez a pasta `docs/`.

O feed atual só é válido até **31/12/2026**.

## Ver localmente

```
node scripts/serve.mjs
```

e abrir http://localhost:8080. Os links podem ser partilhados, por exemplo `#linha/U01` ou `#paragem/2`.

## Publicar de graça

A pasta `docs/` é estática (HTML/CSS/JS), por isso serve em qualquer alojamento gratuito: GitHub Pages, Netlify, Cloudflare Pages, ou o próprio servidor do site da CMG.
