import { supabaseAdmin } from '@/integrations/supabase/client.server';
import { estaNoHorario, formatarTelefone, randomEntre, escolherAleatorio } from './phone';
import {
  verificarWhatsApp,
  enviarTexto,
  enviarMidia,
} from './whatsapp.server';

interface InstanciaSelecionada {
  id: string;
  nome: string;
  token: string;
}

interface MidiaVariacao {
  url: string;
  tipo: string;
  nome: string;
}

interface Campanha {
  id: string;
  usuario_id: string;
  nome: string;
  mensagem: string;
  mensagens_variacoes: string[];
  midias_variacoes: MidiaVariacao[];
  instancias_selecionadas: InstanciaSelecionada[];
  instancia_token: string | null;
  horario_inicio: string;
  horario_fim: string;
  delay_minimo: number;
  delay_maximo: number;
  delay_mensagens: number;
  midia_url: string | null;
  midia_tipo: string | null;
  midia_nome: string | null;
  status: string;
}

interface ContatoCampanha {
  id: string;
  campanha_id: string;
  telefone: string;
  nome: string | null;
  empresa: string | null;
  status: string;
  next_send_at: string | null;
}

function aplicarVariaveis(mensagem: string, contato: ContatoCampanha): string {
  return mensagem
    .replace(/\{nome\}/g, contato.nome ?? '')
    .replace(/\{empresa\}/g, contato.empresa ?? '')
    .replace(/\{telefone\}/g, contato.telefone);
}

function selecionarMensagem(campanha: Campanha): string {
  const variacoes = campanha.mensagens_variacoes ?? [];
  const base = variacoes.length > 0
    ? (escolherAleatorio(variacoes) ?? campanha.mensagem)
    : campanha.mensagem;
  return base;
}

function selecionarInstancia(campanha: Campanha): InstanciaSelecionada | null {
  const lista = campanha.instancias_selecionadas ?? [];
  if (lista.length > 0) return escolherAleatorio(lista);
  if (campanha.instancia_token) {
    return { id: '', nome: '', token: campanha.instancia_token };
  }
  return null;
}

async function marcarContatoEnviado(
  contatoId: string,
  instanciaToken: string,
  mensagemEnviada: string,
) {
  await supabaseAdmin
    .from('contatos_campanha')
    .update({
      status: 'enviado',
      instancia_usada: instanciaToken,
      mensagem_enviada: mensagemEnviada,
    })
    .eq('id', contatoId);
}

async function marcarContatoInvalido(contatoId: string) {
  await supabaseAdmin
    .from('contatos_campanha')
    .update({ status: 'invalido', wpp_valido: false })
    .eq('id', contatoId);
}

async function marcarContatoErro(contatoId: string) {
  await supabaseAdmin
    .from('contatos_campanha')
    .update({ status: 'erro' })
    .eq('id', contatoId);
}

async function agendarProximoContato(
  campanhaId: string,
  contatoAtualId: string,
  delayMin: number,
  delayMax: number,
): Promise<ContatoCampanha | null> {
  const { data } = await supabaseAdmin
    .from('contatos_campanha')
    .select('*')
    .eq('campanha_id', campanhaId)
    .eq('status', 'pendente')
    .neq('id', contatoAtualId)
    .is('next_send_at', null)
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  const delaySeg = randomEntre(delayMin, delayMax);
  const nextSendAt = new Date(Date.now() + delaySeg * 1000).toISOString();

  await supabaseAdmin
    .from('contatos_campanha')
    .update({ next_send_at: nextSendAt })
    .eq('id', data.id);

  return { ...data, next_send_at: nextSendAt } as ContatoCampanha;
}

async function processarContato(
  contato: ContatoCampanha,
  campanha: Campanha,
): Promise<void> {
  const telefone = formatarTelefone(contato.telefone);
  const instancia = selecionarInstancia(campanha);

  if (!instancia) {
    await marcarContatoErro(contato.id);
    return;
  }

  // Verifica se tem WhatsApp
  const verificacao = await verificarWhatsApp(telefone, instancia.token);
  if (!verificacao.isInWhatsapp) {
    await marcarContatoInvalido(contato.id);
    return;
  }

  const jid = verificacao.jid ?? `${telefone}@s.whatsapp.net`;
  const mensagemBase = selecionarMensagem(campanha);
  const mensagemFinal = aplicarVariaveis(mensagemBase, contato);

  // Seleciona mídia aleatória (midias_variacoes tem prioridade; fallback para midia_url legado)
  const todasMidias: MidiaVariacao[] = campanha.midias_variacoes?.length > 0
    ? campanha.midias_variacoes
    : (campanha.midia_url && campanha.midia_tipo)
    ? [{ url: campanha.midia_url, tipo: campanha.midia_tipo, nome: campanha.midia_nome ?? 'arquivo' }]
    : [];
  const midia = todasMidias.length > 0 ? escolherAleatorio(todasMidias) : null;

  if (midia) {
    const midiaOk = await enviarMidia(jid, midia.url, midia.tipo, midia.nome, mensagemFinal, instancia.token);
    if (!midiaOk) {
      // Mídia falhou — envia só texto como fallback
      await enviarTexto(jid, mensagemFinal, instancia.token);
    }
    // Mídia enviada com sucesso: legenda já está embutida, não envia texto separado
  } else {
    await enviarTexto(jid, mensagemFinal, instancia.token);
  }

  await marcarContatoEnviado(contato.id, instancia.token, mensagemFinal);
}

async function verificarCampanhaConcluida(campanhaId: string): Promise<boolean> {
  const { count } = await supabaseAdmin
    .from('contatos_campanha')
    .select('id', { count: 'exact', head: true })
    .eq('campanha_id', campanhaId)
    .eq('status', 'pendente');

  return (count ?? 0) === 0;
}

async function processarCampanha(campanha: Campanha): Promise<void> {
  if (!estaNoHorario(campanha.horario_inicio ?? '08:00', campanha.horario_fim ?? '22:00')) {
    return;
  }

  const limite = Date.now() + 50_000; // processa por no máximo 50s desta campanha

  while (Date.now() < limite) {
    // Busca próximo contato elegível: apenas os que têm next_send_at agendado e já passou
    // Contatos com next_send_at IS NULL ainda não foram agendados — nunca devem ser disparados aqui
    const { data: contatos } = await supabaseAdmin
      .from('contatos_campanha')
      .select('*')
      .eq('campanha_id', campanha.id)
      .eq('status', 'pendente')
      .not('next_send_at', 'is', null)
      .lte('next_send_at', new Date().toISOString())
      .order('next_send_at', { ascending: true })
      .limit(1);

    const contato = contatos?.[0] as ContatoCampanha | undefined;
    if (!contato) break;

    await processarContato(contato, campanha);

    // Agenda o próximo contato
    const proximo = await agendarProximoContato(
      campanha.id,
      contato.id,
      campanha.delay_minimo ?? 5,
      campanha.delay_maximo ?? 15,
    );

    if (!proximo) {
      // Não há mais pendentes sem agendamento — verifica se campanha acabou
      if (await verificarCampanhaConcluida(campanha.id)) {
        await supabaseAdmin
          .from('campanhas')
          .update({ status: 'concluida' })
          .eq('id', campanha.id);
      }
      break;
    }

    // Aguarda até next_send_at do próximo contato (se caber no limite)
    const espera = new Date(proximo.next_send_at!).getTime() - Date.now();
    if (espera > 0) {
      if (Date.now() + espera > limite) break; // não cabe — deixa o próximo cron processar
      await new Promise((r) => setTimeout(r, espera));
    }
  }

  // Atualiza contadores da campanha
  const [{ count: enviadas }, { count: erros }, { count: invalidos }] = await Promise.all([
    supabaseAdmin
      .from('contatos_campanha')
      .select('id', { count: 'exact', head: true })
      .eq('campanha_id', campanha.id)
      .eq('status', 'enviado'),
    supabaseAdmin
      .from('contatos_campanha')
      .select('id', { count: 'exact', head: true })
      .eq('campanha_id', campanha.id)
      .eq('status', 'erro'),
    supabaseAdmin
      .from('contatos_campanha')
      .select('id', { count: 'exact', head: true })
      .eq('campanha_id', campanha.id)
      .eq('status', 'invalido'),
  ]);

  await supabaseAdmin
    .from('campanhas')
    .update({ enviadas: enviadas ?? 0, erros: (erros ?? 0) + (invalidos ?? 0) })
    .eq('id', campanha.id);
}

async function ativarCampanhasAgendadas(): Promise<void> {
  const agora = new Date().toISOString();

  const { data: campanhas } = await supabaseAdmin
    .from('campanhas')
    .select('id')
    .eq('status', 'agendada')
    .lte('agendada_para', agora);

  if (!campanhas?.length) return;

  for (const c of campanhas) {
    await supabaseAdmin
      .from('campanhas')
      .update({ status: 'em_andamento' })
      .eq('id', c.id);

    // Agenda o primeiro contato para agora
    const { data: primeiroContato } = await supabaseAdmin
      .from('contatos_campanha')
      .select('id')
      .eq('campanha_id', c.id)
      .eq('status', 'pendente')
      .order('id', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (primeiroContato) {
      await supabaseAdmin
        .from('contatos_campanha')
        .update({ next_send_at: agora })
        .eq('id', primeiroContato.id);
    }
  }
}

export async function processarDisparo(): Promise<{ processadas: number; erros: string[] }> {
  const erros: string[] = [];
  let processadas = 0;

  try {
    await ativarCampanhasAgendadas();
  } catch (e) {
    erros.push(`ativarAgendadas: ${String(e)}`);
  }

  // Busca campanhas ativas (em_andamento)
  const { data: campanhas } = await supabaseAdmin
    .from('campanhas')
    .select('*')
    .eq('status', 'em_andamento');

  if (!campanhas?.length) return { processadas, erros };

  for (const c of campanhas) {
    try {
      const campanha = c as unknown as Campanha;
      campanha.instancias_selecionadas =
        (c.instancias_selecionadas as unknown as InstanciaSelecionada[]) ?? [];
      campanha.mensagens_variacoes =
        (c.mensagens_variacoes as unknown as string[]) ?? [];
      campanha.midias_variacoes =
        (c.midias_variacoes as unknown as MidiaVariacao[]) ?? [];

      await processarCampanha(campanha);
      processadas++;
    } catch (e) {
      erros.push(`campanha ${c.id}: ${String(e)}`);
    }
  }

  return { processadas, erros };
}

export async function iniciarCampanhaImediata(campanhaId: string): Promise<void> {
  const agora = new Date().toISOString();

  await supabaseAdmin
    .from('campanhas')
    .update({ status: 'em_andamento' })
    .eq('id', campanhaId);

  const { data: primeiroContato } = await supabaseAdmin
    .from('contatos_campanha')
    .select('id')
    .eq('campanha_id', campanhaId)
    .eq('status', 'pendente')
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (primeiroContato) {
    await supabaseAdmin
      .from('contatos_campanha')
      .update({ next_send_at: agora })
      .eq('id', primeiroContato.id);
  }
}

export async function pausarCampanha(campanhaId: string): Promise<void> {
  await supabaseAdmin
    .from('campanhas')
    .update({ status: 'pausada' })
    .eq('id', campanhaId);
}

export async function retomarCampanha(campanhaId: string): Promise<void> {
  await supabaseAdmin
    .from('campanhas')
    .update({ status: 'em_andamento' })
    .eq('id', campanhaId);
}

export async function cancelarCampanha(campanhaId: string): Promise<void> {
  await supabaseAdmin
    .from('campanhas')
    .update({ status: 'cancelada' })
    .eq('id', campanhaId);

  await supabaseAdmin
    .from('contatos_campanha')
    .update({ status: 'cancelado' })
    .eq('campanha_id', campanhaId)
    .eq('status', 'pendente');
}
