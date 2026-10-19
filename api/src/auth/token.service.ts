import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'crypto';
import { Env } from '../config/env.validation';
import { DatabaseService } from '../database/database.service';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly db: DatabaseService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async issue(userId: string, role: string): Promise<TokenPair> {
    const expiresIn = this.config.get('ACCESS_TTL_SECONDS', { infer: true });
    const accessToken = await this.jwt.signAsync({ sub: userId, role }, { expiresIn });
    const refreshToken = randomBytes(48).toString('base64url');
    await this.db.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, now() + make_interval(days => $3))`,
      [userId, sha256(refreshToken), this.config.get('REFRESH_TTL_DAYS', { infer: true })],
    );
    return { accessToken, refreshToken, expiresIn };
  }

  /** Rotation : l'ancien jeton est révoqué atomiquement, un nouveau couple est émis. */
  async rotate(refreshToken: string): Promise<TokenPair> {
    const { rows } = await this.db.query<{ user_id: string }>(
      `UPDATE refresh_tokens SET revoked_at = now()
       WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()
       RETURNING user_id`,
      [sha256(refreshToken)],
    );
    if (!rows[0]) throw new UnauthorizedException('Jeton invalide ou expiré');
    const user = await this.db.query<{ role: string }>('SELECT role FROM users WHERE id = $1', [rows[0].user_id]);
    if (!user.rows[0]) throw new UnauthorizedException();
    return this.issue(rows[0].user_id, user.rows[0].role);
  }

  async revoke(refreshToken: string): Promise<void> {
    await this.db.query(
      `UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`,
      [sha256(refreshToken)],
    );
  }
}
