# 003 — Los contratos son una lente aparte, no ítems de trabajo

Fecha: 2026-10-05 · Estado: vigente

## Contexto

Las cuatro órdenes contractuales de prestación de servicios declaran, cada una,
sus obligaciones específicas y un porcentaje de avance autorreportado. El
informe técnico, por su parte, documenta el trabajo entregado y a quién se
atribuye.

Las dos fuentes **no coinciden**.

## Decisión

Cada fuente manda en lo suyo y ninguna sobrescribe a la otra:

- **Los contratos** son autoritativos para la identidad de las personas y para
  el alcance contratado.
- **El informe técnico** es autoritativo para el trabajo entregado.

Por eso `contracts[]` es una colección propia y **no** alimenta `items[]`. Los
porcentajes contractuales son autodeclarados por obligación y no llevan
ponderación alguna; mezclarlos con el avance de ejecución reformularía en
silencio cuánto del programa está hecho.

El indicador general del tablero cuenta ítems de trabajo. El avance contratado
se muestra aparte, dentro de la tarjeta de cada persona.

## Discrepancias publicadas como hallazgos

| Hallazgo | Severidad |
|---|---|
| El objeto contractual nombra el proyecto SIP-UNAL, no el indicador E2-02-A2 del informe | alta |
| Ninguna orden contiene la obligación de ETL y OCR que el informe atribuye | alta |
| Dos órdenes comparten las diez obligaciones y el mismo Producto 1 | alta |
| El alcance contratado de plataforma excede lo que el informe llama backend | baja |
| Un informe de ejecución cubre un periodo anterior al inicio de su contrato | media |
| El acervo tiene cuatro orígenes documentales; el informe declara tres | media |
| Una quinta integrante del equipo no tiene orden contractual en la carpeta | media |

## Qué no se publica

El repositorio es público y deriva de fuentes privadas: un informe con
presupuesto y unos paquetes de pago con datos personales.

Quedan fuera las cifras monetarias, tarifas, valores de contrato, números de
identificación, teléfonos, direcciones y correos. Dos pruebas automáticas lo
verifican en cada corrida de CI; una de ellas descarta primero los colores
hexadecimales, que son series de seis dígitos que no identifican a nadie.

## Validación propia de la colección

- El avance acumulado nunca puede ser menor que el del periodo, porque lo
  incluye.
- Toda obligación declara ambos porcentajes entre 0 y 100.
- Todo contrato pertenece a una persona registrada y lista al menos una
  obligación.
