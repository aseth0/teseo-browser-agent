import { describe, expect, it } from 'vitest';
import { rulesFor } from '../src/speech/languages';
import { clampSize, cutPoint, FIRST_PIECE, isMidSentence, pieces } from '../src/speech/pieces';
import { capped, readingPlan } from '../src/speech/plan';
import { pairsText, parsePairs, spoken } from '../src/speech/spoken';

// Reading aloud: the text cut into pieces (a short first one, whole sentences, a long sentence cut at a
// pause), each said as the language's rules and the user's pairs say. The test texts are Spanish, the
// language with rules (an agreed exception to English only).

// A short first sentence, then enough text for two more pieces.
const SELECTION = [
  'Primera frase corta.',
  'La segunda frase es bastante más larga que la primera, para que no quepa con ella en el primer trozo y abra uno nuevo.',
  'x'.repeat(250) + '.',
].join(' ');

describe('the pieces of a text', () => {
  it('start short, keep whole sentences, lose and repeat nothing, and none is longer than its share', () => {
    const parts = pieces(SELECTION, 120, 300);
    expect(parts[0]).toBe('Primera frase corta.');
    expect(parts).toHaveLength(3);
    expect(parts.join(' ')).toBe(SELECTION);
    expect(parts.every((p) => p.length <= 300)).toBe(true);
  });

  it('take their sizes as given: a first piece large enough holds it all', () => {
    expect(pieces(SELECTION, 400, 300)).toEqual([SELECTION]);
  });

  it('cut a long sentence at its last pause that fits, not inside a clause', () => {
    const text =
      'Dos cosas sin comprobar: que el servidor tenga instaladas nova_a y nova_b (solo probé nova_c con una petición real), y que el selector se dibuje bien en la app. La voz va a 1.15 ahora.';
    const parts = pieces(text, 120, 300);
    expect(parts).toEqual([
      'Dos cosas sin comprobar: que el servidor tenga instaladas nova_a y nova_b (solo probé nova_c con una petición real),',
      'y que el selector se dibuje bien en la app. La voz va a 1.15 ahora.',
    ]);
    // The piece that stops at the comma loses its closing silence; the last keeps it.
    expect(parts.map((_, i) => isMidSentence(parts, i))).toEqual([true, false]);
  });

  it('cut at a space when there is no pause past the first third, and anywhere when there is no space', () => {
    expect(cutPoint('a, ' + 'b '.repeat(30), 20)).toBe(18);
    expect(cutPoint('x'.repeat(50), 20)).toBe(20);
  });

  it('end a sentence at a line break, and never at a mark inside a number', () => {
    expect(pieces('Uno 1.15 dos\ntres', 12, 300)).toEqual(['Uno 1.15 dos', 'tres']);
  });

  it('have sizes bounded', () => {
    expect(clampSize(undefined, FIRST_PIECE)).toBe(120);
    expect(clampSize(5, FIRST_PIECE)).toBe(40);
    expect(clampSize(99_999, FIRST_PIECE)).toBe(2000);
  });
});

describe('a text as it is said', () => {
  const pairs = parsePairs('example.test=example punto test\nnova_c = nova ce');

  it('in Spanish: numbers, units and the user\'s own pairs', () => {
    expect(spoken('El recorte quitó 0,26 s y tarda 45 ms; 1 s con nova_c en example.test, a 1.15 y 0,05, el 30% de 1.000.000, v2.1.321.', pairs, rulesFor('es'))).toBe(
      'El recorte quitó 0 coma 26 segundos y tarda 45 milisegundos; 1 segundo con nova ce en example punto test, a 1 punto 15 y 0 coma cero 5, el 30 por ciento de 1000000, v2 punto 1 punto 321.',
    );
  });

  it('units: one and several, the longest first, never inside a word', () => {
    const es = rulesFor('es-ES');
    expect(spoken('5 min, 2 km, 3 GB, 1 h y 10€', [], es)).toBe('5 minutos, 2 kilómetros, 3 gigabytes, 1 hora y 10 euros');
    expect(spoken('3 sillas y 4 mesas', [], es)).toBe('3 sillas y 4 mesas');
  });

  it('in a language without rules: as written, with the pairs', () => {
    expect(rulesFor('en')).toBeUndefined();
    expect(rulesFor(undefined)).toBeUndefined();
    expect(spoken('It took 0.26 s on example.test', pairs, rulesFor('en'))).toBe('It took 0.26 s on example punto test');
  });

  it('the pairs as typed: one per line, a line without "=" left out', () => {
    expect(parsePairs(' a = b \nnothing\n= x\nc=')).toEqual([{ written: 'a', said: 'b' }, { written: 'c', said: '' }]);
    expect(pairsText([{ written: 'a', said: 'b' }])).toBe('a = b');
  });
});

describe('a reading plan', () => {
  it('cuts first, then says each piece, and marks those that stop inside a sentence', () => {
    const plan = readingPlan('Tarda 0,5 s, más o menos, cuando el servidor está libre y nada más lo usa nadie, ni siquiera de noche. Fin.', { first: 60, rest: 300, language: 'es' });
    expect(plan).toEqual([
      { input: 'Tarda 0 coma 5 segundos, más o menos,', trim: true },
      { input: 'cuando el servidor está libre y nada más lo usa nadie, ni siquiera de noche. Fin.', trim: false },
    ]);
  });
});

describe('a text longer than what is read at a time', () => {
  it('is cut at the end of its last whole sentence that fits, and says so', () => {
    const text = 'Una frase. Otra frase algo más larga. Y una tercera que ya no cabe entera en el tope.';
    expect(capped(text, 45)).toEqual({ text: 'Una frase. Otra frase algo más larga.', cut: true });
    expect(capped(text, 1000)).toEqual({ text, cut: false });
  });

  it('with no sentence end past half of it, at a pause or a space, never mid-word', () => {
    const { text, cut } = capped('palabra '.repeat(40).trim(), 100);
    expect(cut).toBe(true);
    expect(text.length).toBeLessThanOrEqual(100);
    expect(text.endsWith('palabra')).toBe(true);
  });
});
