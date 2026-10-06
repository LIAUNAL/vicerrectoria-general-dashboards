# 002 — Qué cronograma sigue el tablero

Fecha: 2026-10-05 · Estado: vigente

## Contexto

El informe técnico de origen contiene **dos cronogramas que no coinciden** y no
se halló en la fuente una relación explícita entre ambos.

| Fuente | Horizonte | Hitos | Estado de ejecución |
|---|---|---|---|
| `06_cronograma.tex` | 24 meses, 4 fases + transversales | H1–H6 | No registra |
| `diag_gantt.tex` | 7 quincenas, 14 ago – 30 nov 2026 | M1–M2 | `hecho` / `pendiente` por actividad |

El segundo rotula su fase 4 como **OE4**, un objetivo que la sección de
objetivos no declara: allí solo existen OE1, OE2 y OE3.

## Decisión

El tablero operativo sigue el **cronograma de quincenas**, porque es el único
que registra estado de ejecución y porque su ventana coincide exactamente con
el plazo de las órdenes contractuales (14 ago – 30 nov 2026).

El plan a 24 meses se conserva como **hoja de ruta informativa**, en un bloque
`roadmap` separado con su propia base de tiempo.

La divergencia **no se resuelve en silencio**: se publica como hallazgo en el
propio tablero, junto con la referencia a un OE4 inexistente.

## Por qué periodos explícitos y no desplazamientos de mes

Las quincenas son irregulares: la segunda de cada mes dura entre 13 y 16 días.
Calcular fechas sumando meses a una fecha de inicio reportaría mal cada segunda
quincena. Por eso cada periodo declara su propio rango de calendario:

```json
{ "index": 1, "label": "14–31 ago 2026", "startDate": "2026-08-14", "endDate": "2026-08-31" }
```

## Consecuencias

- `program.timeUnit` admite `fortnight` y `month`, y el tablero no asume ninguno.
- El `roadmap` se valida contra su propio horizonte, nunca contra los periodos.
- Determinar la relación entre los dos cronogramas corresponde a la supervisión,
  no al tablero.
