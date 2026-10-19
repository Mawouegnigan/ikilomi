import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env.validation';

export interface SmsProvider {
  send(phone: string, message: string): Promise<void>;
}

/**
 * En développement, le SMS est écrit dans les logs.
 * En production, brancher un vrai fournisseur (agrégateur SMS local, Twilio,
 * Africa's Talking...) en implémentant SmsProvider.
 */
@Injectable()
export class SmsService implements SmsProvider {
  private readonly logger = new Logger(SmsService.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  async send(phone: string, message: string): Promise<void> {
    if (this.config.get('NODE_ENV', { infer: true }) === 'production') {
      throw new Error('Aucun fournisseur SMS configuré pour la production');
    }
    this.logger.warn(`[SMS DEV] ${phone} -> ${message}`);
  }
}
