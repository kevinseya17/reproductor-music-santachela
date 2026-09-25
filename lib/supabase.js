/**
 * lib/supabase.js
 * Cliente Supabase y funciones de ayuda para persistencia en la nube.
 * Si SUPABASE_URL y SUPABASE_KEY no están configuradas, todas las funciones
 * retornan silenciosamente sin error (modo fallback a JSON local).
 */

'use strict';

require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';

/** true si Supabase está configurado en las variables de entorno */
const isConfigured = !!(SUPABASE_URL && SUPABASE_KEY);

let supabase = null;

if (isConfigured) {
  try {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    console.log('[Supabase] ✅ Cliente inicializado correctamente.');
  } catch (err) {
    console.error('[Supabase] ❌ Error al inicializar cliente:', err.message);
  }
} else {
  console.warn('[Supabase] ⚠️  Variables de entorno no configuradas — usando almacenamiento local.');
}

// ─────────────────────────────────────────────────────────────────────────────
// PLAYLISTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Carga todas las listas desde Supabase.
 * @returns {Promise<Array|null>} Array de playlists o null si no hay conexión.
 */
async function loadPlaylists() {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('santachela_playlists')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('[Supabase] Error al cargar listas:', err.message);
    return null;
  }
}

/**
 * Guarda (upsert) una sola playlist en Supabase.
 * @param {Object} playlist - Objeto con { id, name, description, tracks }
 */
async function upsertPlaylist(playlist) {
  if (!supabase || !playlist || !playlist.id) return;
  try {
    const row = {
      id: playlist.id,
      name: playlist.name || '',
      description: playlist.description || '',
      tracks: playlist.tracks || [],
      updated_at: new Date().toISOString()
    };
    const { error } = await supabase
      .from('santachela_playlists')
      .upsert(row, { onConflict: 'id' });
    if (error) throw error;
  } catch (err) {
    console.error('[Supabase] Error al guardar lista:', err.message);
  }
}

/**
 * Guarda todas las playlists en Supabase (upsert en lote).
 * @param {Array} playlists
 */
async function savePlaylists(playlists) {
  if (!supabase || !Array.isArray(playlists) || playlists.length === 0) return;
  try {
    const rows = playlists.map(p => ({
      id: p.id,
      name: p.name || '',
      description: p.description || '',
      tracks: p.tracks || [],
      updated_at: new Date().toISOString()
    }));
    const { error } = await supabase
      .from('santachela_playlists')
      .upsert(rows, { onConflict: 'id' });
    if (error) throw error;
  } catch (err) {
    console.error('[Supabase] Error al guardar listas en lote:', err.message);
  }
}

/**
 * Elimina una playlist de Supabase.
 * @param {string} id - ID de la playlist a eliminar.
 */
async function deletePlaylist(id) {
  if (!supabase || !id) return;
  try {
    const { error } = await supabase
      .from('santachela_playlists')
      .delete()
      .eq('id', id);
    if (error) throw error;
  } catch (err) {
    console.error('[Supabase] Error al eliminar lista:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STATE (settings, queue, history, tableRequests, bannedTables)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Carga un valor de estado desde Supabase.
 * @param {string} key - Clave del estado (e.g. 'settings', 'queue').
 * @returns {Promise<any|null>}
 */
async function loadState(key) {
  if (!supabase || !key) return null;
  try {
    const { data, error } = await supabase
      .from('santachela_state')
      .select('data')
      .eq('key', key)
      .single();
    if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows found
    return data?.data ?? null;
  } catch (err) {
    console.error(`[Supabase] Error al cargar estado '${key}':`, err.message);
    return null;
  }
}

/**
 * Guarda un valor de estado en Supabase.
 * @param {string} key - Clave del estado.
 * @param {any} value - Valor a guardar (será serializado como JSONB).
 */
async function saveState(key, value) {
  if (!supabase || !key) return;
  try {
    const { error } = await supabase
      .from('santachela_state')
      .upsert(
        { key, data: value, updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      );
    if (error) throw error;
  } catch (err) {
    console.error(`[Supabase] Error al guardar estado '${key}':`, err.message);
  }
}

module.exports = {
  isConfigured,
  loadPlaylists,
  savePlaylists,
  upsertPlaylist,
  deletePlaylist,
  loadState,
  saveState
};
