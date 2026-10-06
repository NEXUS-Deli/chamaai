// "Lembrar de mim" no login.
// LEMBRAR_KEY (localStorage): "0" quando o usuário desmarcou a opção.
// SESSAO_KEY (sessionStorage): existe enquanto o navegador/aba estiver aberto.
export const LEMBRAR_KEY = "p360:lembrar";
export const SESSAO_KEY = "p360:sessao";

/** true quando o usuário pediu para não ser lembrado e o navegador foi fechado desde o login. */
export function sessaoDeveExpirar(): boolean {
  try {
    return localStorage.getItem(LEMBRAR_KEY) === "0" && sessionStorage.getItem(SESSAO_KEY) !== "1";
  } catch {
    return false;
  }
}
