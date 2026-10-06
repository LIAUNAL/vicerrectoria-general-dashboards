# Vicerrectoría General — Dashboards

Tablero público de seguimiento del **prototipo de tablero institucional basado
en agentes RAG para el sistema de auditoría interna** de la Universidad
Nacional de Colombia (indicador **E2-02-A2**), en alianza entre la
Vicerrectoría General, el Laboratorio de Inteligencia Artificial (LabIA) y el
grupo GCPDS.

**Tablero:** https://liaunal.github.io/vicerrectoria-general-dashboards/

## Qué hay aquí

Una sola fuente de verdad, `data/board.json`, y dos capas encima:

| Capa | Para qué | Dónde |
| --- | --- | --- |
| Tablero estático | Lectura pública: avance, cronograma, entregables, hitos | `site/` → GitHub Pages |
| Integración con Paca | Operación diaria del equipo sobre un tablero interactivo | `paca/` |

```
Paca (autohospedado, interactivo)  ──sync──▶  data/board.json  ──build──▶  GitHub Pages
            ▲                                       │
            └──────────────── seed ─────────────────┘
```

### Por qué dos capas y no una

[Paca](https://github.com/Paca-AI/paca) es la plataforma de gestión donde
personas y agentes de IA trabajan sobre el mismo tablero. Necesita PostgreSQL y
cuatro servicios en Go. GitHub Pages sirve archivos estáticos y nada más, así
que **Paca no se puede desplegar en Pages**. En lugar de forzar una de las dos
opciones, el tablero operativo vive en Paca y el espejo público se publica
desde el mismo archivo de datos. Detalles en [`paca/README.md`](paca/README.md).

## Estructura

```
data/board.json           fuente de verdad: fases, ítems, contratos, entregables, hallazgos
schema/board.schema.json  contrato estructural del archivo de datos
lib/board.mjs             reglas de dominio: validación, avance, calendario, acentos
site/                     tablero estático (HTML, CSS y un módulo ES)
paca/                     cliente, siembra y sincronización con Paca
scripts/                  verificación, construcción y servidor local
docs/decisiones/          por qué el repositorio es como es
test/                     79 pruebas sobre dominio, datos, contratos y mapeo a Paca
```

Si va a cambiar algo estructural, lea antes el
[registro de decisiones](docs/decisiones/README.md): cada una documenta el hecho
que la obligó, no solo la preferencia.

`lib/board.mjs` lo importan el sitio, la verificación de CI y los scripts de
Paca sin copia intermedia, así que el tablero no puede discrepar de la
verificación sobre qué significan los datos.

## Uso

Requiere Node 22 o superior. **No tiene dependencias**: todo corre sobre la
biblioteca estándar, así que no hay `npm install`.

```bash
npm test          # pruebas de dominio, datos y mapeo
npm run check     # valida data/board.json e imprime el avance
npm run build     # arma dist/ para publicar
npm run serve     # construye y sirve en http://localhost:4173
```

`npm run check` resume el estado:

```
OK    data/board.json
      program      Tablero Institucional RAG ... (E2-02-A2)
      window       2026-08-14 -> 2026-11-30 (7 fortnights)
      items        20 (13 done, 65%)
      F1     100%  5/5  Base de datos probatoria
      ...
```

## Actualizar el tablero

Dos caminos, según dónde ocurra el trabajo.

**Editando los datos.** Modifique `data/board.json`, corra `npm run check` y
haga commit. Pages se despliega solo al llegar a `main`.

**Desde Paca.** Corra `node paca/sync.mjs` para ver qué cambió, luego
`--apply` para escribirlo, revise el diff y haga commit. Publicar pasa por un
commit a propósito: así cada cambio del tablero público queda revisable en la
historia.

## Cronogramas: una divergencia de la fuente

El informe técnico de origen contiene **dos cronogramas que no coinciden**:

- un plan a 24 meses con hitos H1–H6, y
- un cronograma de ejecución en 7 quincenas (14 ago – 30 nov 2026) con estado
  `hecho`/`pendiente` por actividad e hitos M1–M2.

Este tablero sigue el de quincenas, porque es el único que registra estado de
ejecución, y conserva el plan a 24 meses como hoja de ruta informativa. La
divergencia no se resuelve en silencio: se publica como hallazgo en el propio
tablero, junto con las demás discrepancias detectadas en los datos de origen.

## Alcance de lo publicado

El repositorio de origen,
[`LIAUNAL/InformeTecnico_Dashboards_VG`](https://github.com/LIAUNAL/InformeTecnico_Dashboards_VG),
es privado y contiene presupuesto e información contractual. Este tablero es
público y publica únicamente objetivos, actividades, entregables, cronograma y
estado de avance. **No** incluye cifras presupuestales, tarifas, valores de
contrato ni identificadores personales; una prueba automática lo verifica en
cada corrida de CI.

## Licencia

Apache-2.0, igual que [Paca](https://github.com/Paca-AI/paca). Ver
[`LICENSE`](LICENSE).
