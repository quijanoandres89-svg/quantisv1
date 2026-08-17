/* ============================================================
   SUPABASE CLIENT — instancia única compartida por toda la app.
   ------------------------------------------------------------
   Esto reemplaza a server.py + data/quantis-data.json (el
   servidor local + Google Drive). Los datos viven en la base de
   datos de Supabase; cada PC lee/escribe directo ahí en cuanto
   el usuario inicia sesión, sin depender de sincronizar archivos.

   El SDK se importa de forma DINÁMICA (no como import estático al
   inicio del archivo) y con try/catch. Si esa importación falla
   (sin internet, DNS bloqueado, etc.) un import estático tumbaría
   TODO main.js sin avisar — con import() dinámico el error queda
   contenido aquí y el resto de la app puede seguir funcionando
   con el respaldo local.
   ============================================================ */

// TODO: reemplaza estos dos valores por los de tu proyecto
// (Supabase → Project Settings → API).
const SUPABASE_URL = "https://zlqxakigxbvyrqgtnkbr.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpscXhha2lneGJ2eXJxZ3Rua2JyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY0NDcyMjMsImV4cCI6MjEwMjAyMzIyM30.tvm9jmQyqwGS-o1jBpC8dm7L_6qrGxayfAJUGMLr8gY";

let _client = null;
let _loadPromise = null;

async function loadClient() {
  if (_client) return _client;

  if (!_loadPromise) {
    _loadPromise = (async () => {
      const { createClient } = await import(
        "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm"
      );

      _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
        },
      });

      return _client;
    })().catch((error) => {
      _loadPromise = null; // permite reintentar en la próxima llamada
      throw new Error(
        `No se pudo cargar Supabase (revisa tu conexión a internet): ${error.message}`,
      );
    });
  }

  return _loadPromise;
}

/** Devuelve el cliente de Supabase, cargándolo si hace falta. */
export async function getSupabase() {
  return loadClient();
}

/** Devuelve el usuario logueado actual, o null si no hay sesión
 * (o si Supabase no se pudo cargar). */
export async function getCurrentUser() {
  try {
    const supabase = await getSupabase();
    const { data, error } = await supabase.auth.getSession();

    if (error) {
      console.error("QUANTIS: error obteniendo sesión:", error);
      return null;
    }

    return data?.session?.user ?? null;
  } catch (error) {
    console.error("QUANTIS:", error.message);
    return null;
  }
}

