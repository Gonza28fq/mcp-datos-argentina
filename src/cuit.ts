/** Validación de CUIT/CUIL por dígito verificador (módulo 11). */

const PESOS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

/** Quita guiones, puntos y espacios. */
export function normalizarCuit(input: string): string {
  return input.replace(/[\s.\-]/g, "");
}

export function digitoVerificador(primeros10: string): number | null {
  const suma = PESOS.reduce((acc, peso, i) => acc + peso * Number(primeros10[i]), 0);
  const dv = 11 - (suma % 11);
  if (dv === 11) return 0;
  if (dv === 10) return null; // combinación inválida: AFIP/ARCA reasigna prefijo 23/24
  return dv;
}

export function esCuitValido(input: string): boolean {
  const cuit = normalizarCuit(input);
  if (!/^\d{11}$/.test(cuit)) return false;
  if (!/^(20|23|24|25|26|27|30|33|34)/.test(cuit)) return false;
  const dv = digitoVerificador(cuit.slice(0, 10));
  return dv !== null && dv === Number(cuit[10]);
}

export function formatearCuit(cuit: string): string {
  const c = normalizarCuit(cuit);
  return `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}`;
}
