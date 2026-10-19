import { HttpException } from '@nestjs/common';
import { OtpService } from './otp.service';

class FakeRedis {
  store = new Map<string, string>();
  async set(k: string, v: string, _ex?: string, _ttl?: number, nx?: string) {
    if (nx === 'NX' && this.store.has(k)) return null;
    this.store.set(k, v);
    return 'OK';
  }
  async get(k: string) { return this.store.get(k) ?? null; }
  async del(...keys: string[]) { keys.forEach((k) => this.store.delete(k)); return keys.length; }
  async incr(k: string) { const n = Number(this.store.get(k) ?? 0) + 1; this.store.set(k, String(n)); return n; }
  async expire() { return 1; }
  multi() {
    const ops: Array<() => Promise<unknown>> = [];
    const chain = {
      set: (k: string, v: string) => { ops.push(() => this.set(k, v)); return chain; },
      del: (k: string) => { ops.push(() => this.del(k)); return chain; },
      exec: async () => { for (const op of ops) await op(); return []; },
    };
    return chain;
  }
}

describe('OtpService', () => {
  const phone = '+22900000000';
  let redis: FakeRedis;
  let sent: string;
  let service: OtpService;

  beforeEach(() => {
    redis = new FakeRedis();
    sent = '';
    const config = { get: () => 'x'.repeat(32) } as any;
    const sms = { send: async (_p: string, m: string) => { sent = m; } } as any;
    service = new OtpService(redis as any, config, sms);
  });

  it('accepte le bon code puis le rend inutilisable', async () => {
    await service.request(phone);
    const code = sent.match(/\d{6}/)![0];
    expect(await service.verify(phone, code)).toBe(true);
    expect(await service.verify(phone, code)).toBe(false);
  });

  it('refuse un mauvais code', async () => {
    await service.request(phone);
    expect(await service.verify(phone, '000000')).toBe(false);
  });

  it('applique le délai entre deux demandes', async () => {
    await service.request(phone);
    await expect(service.request(phone)).rejects.toBeInstanceOf(HttpException);
  });

  it('bloque après trop de tentatives', async () => {
    await service.request(phone);
    for (let i = 0; i < 5; i++) await service.verify(phone, '111111');
    await expect(service.verify(phone, '111111')).rejects.toBeInstanceOf(HttpException);
  });
});
