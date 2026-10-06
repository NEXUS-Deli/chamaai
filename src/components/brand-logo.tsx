/** Logo Prospecta 360: versão grafite no tema claro e versão com "prospecta" claro no tema escuro. */
export function BrandLogo({ className = "" }: { className?: string }) {
  return (
    <>
      <img src="/prospecta360-logo.png" alt="Prospecta 360" className={`${className} object-contain dark:hidden`} />
      <img src="/prospecta360-logo-dark.png" alt="Prospecta 360" className={`${className} object-contain hidden dark:block`} />
    </>
  );
}

/** Ícone Prospecta 360 (setas), usado com o menu recolhido. */
export function BrandIcon({ className = "" }: { className?: string }) {
  return <img src="/prospecta360-icon.png" alt="Prospecta 360" className={`${className} object-contain`} />;
}
