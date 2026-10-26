interface Cookie {
  name: string;
  value: string;
}

export class CookieJar {
  private map = new Map<string, string>();
  get(name: string): Cookie | undefined {
    const value = this.map.get(name);
    return value === undefined ? undefined : { name, value };
  }
  set(name: string, value: string, opts?: { maxAge?: number }) {
    if (opts?.maxAge === 0 || value === "") this.map.delete(name);
    else this.map.set(name, value);
  }
  delete(name: string) {
    this.map.delete(name);
  }
  getAll(): Cookie[] {
    return [...this.map].map(([name, value]) => ({ name, value }));
  }
  has(name: string) {
    return this.map.has(name);
  }
  clear() {
    this.map.clear();
  }
  snapshot(): Map<string, string> {
    return new Map(this.map);
  }
  restore(snapshot: Map<string, string>) {
    this.map = new Map(snapshot);
  }
}

class CookieStore {
  private current = new CookieJar();
  active() {
    return this.current;
  }
  use(jar: CookieJar) {
    this.current = jar;
  }
}

export const cookieStore = new CookieStore();
