import { IsString, Length, Matches, MinLength } from 'class-validator';

const E164 = /^\+[1-9]\d{7,14}$/;

export class RequestOtpDto {
  @Matches(E164, { message: 'Numéro invalide, format international attendu (ex. +229...)' })
  phone: string;
}

export class VerifyOtpDto {
  @Matches(E164, { message: 'Numéro invalide' })
  phone: string;

  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/)
  code: string;
}

export class RefreshDto {
  @IsString()
  @MinLength(20)
  refreshToken: string;
}
