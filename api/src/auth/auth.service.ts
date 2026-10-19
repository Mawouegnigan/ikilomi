import { Injectable, UnauthorizedException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { OtpService } from './otp.service';
import { TokenPair, TokenService } from './token.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly otp: OtpService,
    private readonly tokens: TokenService,
    private readonly db: DatabaseService,
  ) {}

  requestOtp(phone: string) {
    return this.otp.request(phone);
  }

  async verifyOtp(phone: string, code: string): Promise<TokenPair> {
    const ok = await this.otp.verify(phone, code);
    if (!ok) throw new UnauthorizedException('Code invalide ou expiré');
    const { rows } = await this.db.query<{ id: string; role: string }>(
      `INSERT INTO users (phone) VALUES ($1)
       ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone
       RETURNING id, role`,
      [phone],
    );
    return this.tokens.issue(rows[0].id, rows[0].role);
  }

  refresh(refreshToken: string) {
    return this.tokens.rotate(refreshToken);
  }

  logout(refreshToken: string) {
    return this.tokens.revoke(refreshToken);
  }

  async me(userId: string) {
    const { rows } = await this.db.query(
      'SELECT id, phone, display_name, locale, role, created_at FROM users WHERE id = $1',
      [userId],
    );
    if (!rows[0]) throw new UnauthorizedException();
    return rows[0];
  }
}
