// The chunks of a dictation, numbered as they are recorded: their texts come back in any order and
// go into the box in recording order, a slow one holding back the ones after it.
export class ChunkOrder {
  private next = 0; // the number the next chunk gets
  private shown = 0; // the first one whose text has not gone out yet
  private texts = new Map<number, string>();

  add(): number {
    return this.next++;
  }

  // Its text (empty: nothing to insert), and the texts now ready, in order.
  settle(n: number, text: string): string[] {
    this.texts.set(n, text);
    const ready: string[] = [];
    while (this.texts.has(this.shown)) {
      const t = this.texts.get(this.shown)!;
      this.texts.delete(this.shown++);
      if (t) ready.push(t);
    }
    return ready;
  }

  get pending(): number {
    return this.next - this.shown;
  }
}
