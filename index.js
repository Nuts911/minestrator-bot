require("dotenv").config();

const { Client, GatewayIntentBits } = require("discord.js");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

let interval = null;
let cookies = {}; // Cookies stockés en mémoire

// =======================
// UTILITAIRES
// =======================
async function log(channel, msg) {
    console.log("[LOG]", msg);
    if (channel) channel.send("📡 " + msg).catch(() => {});
}

function buildCookieString(cookieObj) {
    return Object.entries(cookieObj)
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
}

function parseCookies(setCookieHeaders) {
    const result = {};
    for (const header of setCookieHeaders) {
        const part = header.split(";")[0].trim();
        const eqIdx = part.indexOf("=");
        if (eqIdx !== -1) {
            const key = part.substring(0, eqIdx).trim();
            const val = part.substring(eqIdx + 1).trim();
            result[key] = val;
        }
    }
    return result;
}

// =======================
// LOGIN MINESTRATOR
// =======================
async function loginMinestrator(channel) {
    try {
        await log(channel, "🔐 Connexion à Minestrator...");

        const email    = process.env.MINESTRATOR_EMAIL;
        const password = process.env.MINESTRATOR_PASSWORD;

        if (!email || !password) {
            await log(channel, "❌ MINESTRATOR_EMAIL ou MINESTRATOR_PASSWORD manquant !");
            return false;
        }

        // Étape 1 : récupérer la page de login pour le token CSRF
        const getRes = await fetch("https://minestrator.com/login", {
            method: "GET",
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
            }
        });

        const setCookieGet = getRes.headers.getSetCookie ? getRes.headers.getSetCookie() : [];
        const initCookies = parseCookies(setCookieGet);
        const html = await getRes.text();

        // Récupération du token CSRF dans le HTML
        const csrfMatch = html.match(/name="_token"\s+value="([^"]+)"/);
        const csrfToken = csrfMatch ? csrfMatch[1] : null;

        console.log("[LOGIN] CSRF token:", csrfToken ? "trouvé" : "non trouvé");

        // Étape 2 : envoyer le formulaire de login
        const body = new URLSearchParams();
        body.append("email", email);
        body.append("password", password);
        if (csrfToken) body.append("_token", csrfToken);

        const postRes = await fetch("https://minestrator.com/login", {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Cookie": buildCookieString(initCookies),
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
                "Origin": "https://minestrator.com",
                "Referer": "https://minestrator.com/login",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
            },
            body: body.toString(),
            redirect: "manual" // On gère les redirections manuellement pour récupérer les cookies
        });

        console.log("[LOGIN] Status POST:", postRes.status);

        const setCookiePost = postRes.headers.getSetCookie ? postRes.headers.getSetCookie() : [];
        const newCookies = parseCookies(setCookiePost);

        // Fusion des cookies
        cookies = { ...initCookies, ...newCookies };

        // Vérification : on doit avoir PHPSESSID au minimum
        if (!cookies["PHPSESSID"]) {
            await log(channel, "❌ Login échoué — vérifie email/mot de passe dans les variables Railway.");
            return false;
        }

        console.log("[LOGIN] Cookies récupérés:", Object.keys(cookies).join(", "));
        await log(channel, "✅ Connecté à Minestrator !");
        return true;

    } catch (err) {
        console.error("[LOGIN ERREUR]", err);
        await log(channel, "❌ Erreur login: " + err.message);
        return false;
    }
}

// =======================
// RESTART SERVER
// =======================
async function restartServer(channel) {
    try {
        // Si pas de cookies, on tente un login
        if (!cookies["PHPSESSID"]) {
            const ok = await loginMinestrator(channel);
            if (!ok) return;
        }

        await log(channel, "🔄 Envoi de la commande restart...");

        const serverId = (process.env.SERVER_URL || "").split("/").filter(Boolean).pop();

        if (!serverId) {
            await log(channel, "❌ SERVER_URL manquant !");
            return;
        }

        const res = await fetch(`https://mine.sttr.io/server/${serverId}/poweraction`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Cookie": buildCookieString(cookies),
                "Origin": "https://minestrator.com",
                "Referer": "https://minestrator.com/",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"
            },
            body: JSON.stringify({ poweraction: "restart" })
        });

        console.log("[RESTART] Status:", res.status);
        const body = await res.text().catch(() => "");
        console.log("[RESTART] Body:", body.slice(0, 200));

        // Si session expirée → on reconnecte et on réessaie une fois
        if (res.status === 401 || res.status === 403) {
            await log(channel, "⚠️ Session expirée, reconnexion...");
            cookies = {};
            const ok = await loginMinestrator(channel);
            if (!ok) return;
            return await restartServer(channel); // Retry
        }

        if (res.status === 200 || res.status === 201 || res.status === 204) {
            await log(channel, "🎉 RESTART LANCÉ AVEC SUCCÈS !");
        } else {
            await log(channel, `❌ Échec restart (HTTP ${res.status}) — ${body.slice(0, 100)}`);
        }

    } catch (err) {
        console.error("[ERREUR]", err);
        await log(channel, "❌ ERREUR: " + err.message);
    }
}

// =======================
// STOP SYSTEM
// =======================
async function stopSystem(channel) {
    clearInterval(interval);
    interval = null;
    await log(channel, "🛑 Système arrêté proprement.");
}

// =======================
// DISCORD BOT
// =======================
client.once("ready", async () => {
    console.log(`✅ Bot connecté : ${client.user.tag}`);
    // Login automatique au démarrage
    await loginMinestrator(null);
});

client.on("messageCreate", async (message) => {
    if (message.author.bot) return;

    const channel = message.channel;

    // !start
    if (message.content === "!start") {
        if (interval) return message.reply("⚠️ Le système est déjà actif !");
        await message.reply("🚀 Système activé ! Premier restart en cours...");
        await restartServer(channel);
        interval = setInterval(async () => {
            await log(channel, "⏱️ Restart automatique toutes les 3h...");
            await restartServer(channel);
        }, 3 * 60 * 60 * 1000);
    }

    // !stop
    if (message.content === "!stop") {
        await stopSystem(channel);
        await message.reply("🛑 Système arrêté.");
    }

    // !restart
    if (message.content === "!restart") {
        await message.reply("🔄 Restart manuel en cours...");
        await restartServer(channel);
    }

    // !status
    if (message.content === "!status") {
        if (interval) {
            await message.reply("✅ Système **actif** — restart auto toutes les 3h.");
        } else {
            await message.reply("🔴 Système **inactif** — tape `!start` pour démarrer.");
        }
    }

    // !debug
    if (message.content === "!debug") {
        const serverId = (process.env.SERVER_URL || "").split("/").filter(Boolean).pop();
        await message.reply(
            `🔧 **Debug info:**\n` +
            `• SERVER_ID: \`${serverId || "❌ manquant"}\`\n` +
            `• DISCORD_TOKEN: ${process.env.DISCORD_TOKEN ? "✅" : "❌ manquant"}\n` +
            `• EMAIL: ${process.env.MINESTRATOR_EMAIL ? "✅" : "❌ manquant"}\n` +
            `• PASSWORD: ${process.env.MINESTRATOR_PASSWORD ? "✅" : "❌ manquant"}\n` +
            `• Session active: ${cookies["PHPSESSID"] ? "✅ oui" : "🔴 non connecté"}\n` +
            `• Intervalle actif: ${interval ? "✅ oui" : "🔴 non"}`
        );
    }

    // !login (forcer reconnexion manuelle)
    if (message.content === "!login") {
        cookies = {};
        await loginMinestrator(channel);
    }
});

client.login(process.env.DISCORD_TOKEN);