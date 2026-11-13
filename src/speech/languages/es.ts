// Spanish reading rules (speech/spoken): data in Spanish, an agreed exception to English only.
// "0,26 s" is said "0 coma 26 segundos", "1.15" "1 punto 15", "0,05" "0 coma cero 5", "1.000.000" "1000000".
import type { ReadingRules } from './types';

export const ES: ReadingRules = {
  units: {
    ms: ['milisegundo', 'milisegundos'],
    s: ['segundo', 'segundos'],
    min: ['minuto', 'minutos'],
    h: ['hora', 'horas'],
    km: ['kilómetro', 'kilómetros'],
    m: ['metro', 'metros'],
    cm: ['centímetro', 'centímetros'],
    mm: ['milímetro', 'milímetros'],
    kg: ['kilo', 'kilos'],
    g: ['gramo', 'gramos'],
    KB: ['kilobyte', 'kilobytes'],
    MB: ['megabyte', 'megabytes'],
    GB: ['gigabyte', 'gigabytes'],
    TB: ['terabyte', 'terabytes'],
    '%': ['por ciento', 'por ciento'],
    '€': ['euro', 'euros'],
  },
  thousands: '.',
  decimal: { ',': 'coma', '.': 'punto', zero: 'cero' },
};
