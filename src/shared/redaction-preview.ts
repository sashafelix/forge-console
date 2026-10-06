/** A text-only preview; raw bytes remain available to the native validator. */
export function redactEvidence(text: string, knownSecrets: string[] = []): { text: string; redactions: number } {
  let redactions = 0;
  for (const value of knownSecrets.filter((v) => v.length > 0).sort((a,b) => b.length-a.length)) {
    redactions += text.split(value).length - 1;
    text = text.split(value).join('[REDACTED]');
  }
  text = text.replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
    () => { redactions += 1; return '[REDACTED PRIVATE KEY]'; });
  text = text.replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})\b/g,
    () => { redactions += 1; return '[REDACTED]'; });
  text = text.replace(/((?:Bearer|api[_ -]?key|access[_ -]?token|password|secret|authorization)\s*(?:[:=]\s*["']?|\s+))([A-Za-z0-9._~+\/=-]{8,})/gi,
    (_match, prefix: string) => { redactions += 1; return prefix + '[REDACTED]'; });
  return { text, redactions };
}
