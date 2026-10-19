import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import Redis from 'ioredis';
import { Env } from '../config/env.validation';
import { REDIS } from '../redis/redis.module';
import { SmsService } from '../sms/sms.service';

const CODE_TTL = 300; // 5 min
const COOLDOWN = 60; // 1 demande par minute et par numéro
const MAX_TRIES = 5;

@Injectable()
export class OtpService {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly config: ConfigService<Env, true>,
    private readonly sms: SmsService,
  ) {}

  private hash(phone: string, code: string): string {
    return createHmac('sha256', this.config.get('OTP_SECRET', { infer: true }))
      .update(`${phone}:${code}`)
      .digest('hex');
  }

  async request(phone: string): Promise<void> {
    const cooldownKey = `otp:cd:${phone}`;
    const acquired = await this.redis.set(cooldownKey, '1', 'EX', COOLDOWN, 'NX');
    if (!acquired) {
      throw new HttpException('Veuillez patienter avant de redemander un code', HttpStatus.TOO_MANY_REQUESTS);
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.redis
      .multi()
      .set(`otp:code:${phone}`, this.hash(phone, code), 'EX', CODE_TTL)
      .del(`otp:tries:${phone}`)
      .exec();

    try {
      await this.sms.send(phone, `ikilomi : votre code est ${code}. Valable 5 minutes.`);
    } catch (err) {
      await this.redis.del(cooldownKey, `otp:code:${phone}`);
      throw err;
    }
  }

  async verify(phone: string, code: string): Promise<boolean> {
    const triesKey = `otp:tries:${phone}`;
    const tries = await this.redis.incr(triesKey);
    if (tries === 1) await this.redis.expire(triesKey, CODE_TTL);
    if (tries > MAX_TRIES) {
      throw new HttpException('Trop de tentatives, redemandez un code', HttpStatus.TOO_MANY_REQUESTS);
    }

    const stored = await this.redis.get(`otp:code:${phone}`);
    if (!stored) return false;

    const a = Buffer.from(stored, 'hex');
    const b = Buffer.from(this.hash(phone, code), 'hex');
    const valid = a.length === b.length && timingSafeEqual(a, b);
    if (valid) await this.redis.del(`otp:code:${phone}`, triesKey);
    return valid;
  }
}
