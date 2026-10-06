// Estilo de "item selecionado" do sistema — o mesmo do item ativo do menu lateral:
// cartão claro, borda sutil, texto em destaque, ícone verde e uma barra verde
// (embaixo, já que filtros e chips ficam lado a lado).
export const SELECAO_ATIVA =
  "bg-card text-foreground font-semibold shadow-sm ring-1 ring-border " +
  "before:absolute before:bottom-0 before:left-3 before:right-3 before:h-[2px] before:rounded-t-full before:bg-primary " +
  "[&>svg]:text-brand";

/** Botão de filtro segmentado (ex.: 7 dias / 15 dias / 30 dias). Usar dentro de um trilho `bg-muted/60 p-1 gap-1`. */
export function classeFiltro(ativo: boolean) {
  return `relative px-3 py-1.5 rounded-md text-sm transition-colors ${
    ativo ? SELECAO_ATIVA : "text-muted-foreground font-medium hover:bg-card/60 hover:text-foreground"
  }`;
}

/** Chip arredondado de filtro (ex.: status, pastas). */
export function classeChip(ativo: boolean) {
  return `relative px-2.5 py-1 rounded-full text-xs transition-colors ${
    ativo ? SELECAO_ATIVA : "bg-muted text-muted-foreground font-medium hover:text-foreground"
  }`;
}
