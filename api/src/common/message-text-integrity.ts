import { BadRequestException } from '@nestjs/common';

// These patterns indicate text that has already lost its original encoding.
// Never guess the missing accents: '?' cannot be reversed reliably.
const replacementCharacter = /\uFFFD/u;
const mojibake = /Ã[\u0080-\u00bf]|Â[\u00a0-\u00bf]|â[\u0080-\u009f]/u;
const brokenWord = /[\p{Ll}]\?{1,2}[\p{Ll}]/u;
const literalUnicodeEscape = /\\(?:u[0-9a-f]{4}|x[0-9a-f]{2})/iu;

export function hasSuspectMessageEncoding(text: string): boolean {
  return replacementCharacter.test(text) || mojibake.test(text) || brokenWord.test(text) || literalUnicodeEscape.test(text);
}

export function assertReadableMessageText(text: string, field = 'mensagem'): void {
  if (hasSuspectMessageEncoding(text)) {
    throw new BadRequestException(`Há caracteres possivelmente corrompidos em ${field}. Revise os acentos e tente novamente; o texto não foi salvo.`);
  }
}

export function assertValidUtf8Bytes(bytes: Uint8Array): void {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new BadRequestException('O conteúdo recebido não está em UTF-8 válido. Nenhuma mensagem foi registrada.');
  }
}
