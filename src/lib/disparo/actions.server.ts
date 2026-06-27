import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import {
  iniciarCampanhaImediata,
  pausarCampanha,
  retomarCampanha,
  cancelarCampanha,
} from './worker.server';

const campanhaSchema = z.object({ campanhaId: z.string().uuid() });

export const iniciarCampanha = createServerFn({ method: 'POST' })
  .inputValidator(campanhaSchema)
  .handler(async ({ data }) => {
    await iniciarCampanhaImediata(data.campanhaId);
    return { ok: true };
  });

export const pausar = createServerFn({ method: 'POST' })
  .inputValidator(campanhaSchema)
  .handler(async ({ data }) => {
    await pausarCampanha(data.campanhaId);
    return { ok: true };
  });

export const retomar = createServerFn({ method: 'POST' })
  .inputValidator(campanhaSchema)
  .handler(async ({ data }) => {
    await retomarCampanha(data.campanhaId);
    return { ok: true };
  });

export const cancelar = createServerFn({ method: 'POST' })
  .inputValidator(campanhaSchema)
  .handler(async ({ data }) => {
    await cancelarCampanha(data.campanhaId);
    return { ok: true };
  });
