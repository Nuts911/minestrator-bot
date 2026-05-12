require("dotenv").config();

const { Client, GatewayIntentBits, AttachmentBuilder } = require("discord.js");
const puppeteer = require("puppeteer");
const path = require("path");
const fs = require("fs");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

let interval = null;
let browser = null;
let page = null;
let isLoggedIn = false;

// =======================
// UTILITAIRES
// =======================
async function log(channel, msg) {
    console.log("[LOG]", msg);
    if (channel) channel.send("📡 " + msg).catch(() => {});
}

// Prend un screenshot et l'envoie sur Discord
async function screenshot(channel, label = "screenshot") {
    if (!page || !channel) return;
    try {
        const tmpPath = path.join("/tmp", `${label}-${Date.now()}.png`);
        await page.screenshot({ path: tmpPath, fullPage: false });
        const attachment = new AttachmentBuilder(tmpPath, { name: `${label}.png` });
        await channel.send({ content: `📸 **${label}**`, files: [attachment] });
        fs.unlinkSync(tmpPath);
    } catch (err) {
        console.error("[SCREENSHOT ERREUR]", err.message);
    }
}

// =======================
// INIT PUPPETEER
// =======================
async function initBrowser() {
    if (browser) {
        try { await browser.close(); } catch (_) {}
    }
    browser = await puppeteer.launch({
        headless: "new",
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--no-first-run",
            "--no-zygote",
            "--single-process"
        ]
    });
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"
    );
    console.log("[BROWSER] Navigateur lancé");
}

// =======================
// LOGIN MINESTRATOR (via vrai navigateur)
// =======================
async function loginMinestrator(channel) {
    try {
        await log(channel, "🔐 Ouverture du navigateur...");

        if (!browser || !page) await initBrowser();

        const email    = process.env.MINESTRATOR_EMAIL;
        const password = process.env.MINESTRATOR_PASSWORD;

        if (!email || !password) {
            await log(channel, "❌ MINESTRATOR_EMAIL ou MINESTRATOR_PASSWORD manquant !");
            return false;
        }

        await log(channel, "🌐 Chargement de la page login...");
        await page.goto("https://minestrator.com/login", {
            waitUntil: "networkidle2",
            timeout: 30000
        });

        await screenshot(channel, "01-page-login");

        // Remplir le formulaire
        await page.waitForSelector('input[name="email"]', { timeout: 10000 });
        await page.type('input[name="email"]', email, { delay: 50 });
        await page.type('input[name="password"]', password, { delay: 50 });

        await screenshot(channel, "02-formulaire-rempli");

        // Soumettre
        await Promise.all([
            page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }),
            page.click('button[type="submit"]')
        ]);

        await screenshot(channel, "03-apres-login");

        // Vérifier si connecté
        const currentUrl = page.url();
        console.log("[LOGIN] URL après login:", currentUrl);

        if (currentUrl.includes("/login")) {
            await log(channel, "❌ Login échoué — mauvais email/mot de passe ?");
            isLoggedIn = false;
            return false;
        }

        isLoggedIn = true;
        await log(channel, "✅ Connecté à Minestrator !");
        return true;

    } catch (err) {
        console.error("[LOGIN ERREUR]", err);
        if (page) await screenshot(channel, "erreur-login").catch(() => {});
        await log(channel, "❌ Erreur login: " + err.message);
        isLoggedIn = false;
        return false;
    }
}

// =======================
// RESTART SERVER (via vrai navigateur)
// =======================
async function restartServer(channel) {
    try {
        if (!isLoggedIn) {
            const ok = await loginMinestrator(channel);
            if (!ok) return;
        }

        await log(channel, "🔄 Navigation vers le panel serveur...");

        const serverUrl = process.env.SERVER_URL;
        if (!serverUrl) {
            await log(channel, "❌ SERVER_URL manquant !");
            return;
        }

        // Aller sur la page du serveur
        await page.goto(serverUrl, {
            waitUntil: "networkidle2",
            timeout: 30000
        });

        await screenshot(channel, "04-panel-serveur");

        // Extraire l'ID du serveur depuis l'URL
        const serverId = serverUrl.split("/").filter(Boolean).pop();

        // Appel API depuis le contexte navigateur (cookies déjà présents)
        await log(channel, "🔄 Envoi de la commande restart...");

        const result = await page.evaluate(async (serverId) => {
            try {
                const res = await fetch(`https://mine.sttr.io/server/${serverId}/poweraction`, {
                    method: "PUT",
                    headers: {
                        "Content-Type": "application/json",
                        "Accept": "application/json",
                        "Origin": "https://minestrator.com",
                        "Referer": "https://minestrator.com/"
                    },
                    credentials: "include",
                    body: JSON.stringify({ poweraction: "restart" })
                });
                const body = await res.text().catch(() => "");
                return { status: res.status, body: body.slice(0, 300) };
            } catch (err) {
                return { status: 0, body: err.message };
            }
        }, serverId);

        console.log("[RESTART] Status:", result.status);
        console.log("[RESTART] Body:", result.body);

        await screenshot(channel, "05-apres-restart");

        if (result.status === 200 || result.status === 201 || result.status === 204) {
            await log(channel, "🎉 RESTART LANCÉ AVEC SUCCÈS !");
        } else if (result.status === 401 || result.status === 403) {
            await log(channel, "⚠️ Session expirée, reconnexion...");
            isLoggedIn = false;
            await loginMinestrator(channel);
            // Retry une fois
            const result2 = await page.evaluate(async (serverId) => {
                try {
                    const res = await fetch(`https://mine.sttr.io/server/${serverId}/poweraction`, {
                        method: "PUT",
                        headers: {
                            "Content-Type": "application/json",
                            "Accept": "application/json",
                            "Origin": "https://minestrator.com",
                            "Referer": "https://minestrator.com/"
                        },
                        credentials: "include",
                        body: JSON.stringify({ poweraction: "restart" })
                    });
                    const body = await res.text().catch(() => "");
                    return { status: res.status, body: body.slice(0, 300) };
                } catch (err) {
                    return { status: 0, body: err.message };
                }
            }, serverId);

            await screenshot(channel, "06-retry-restart");

            if (result2.status === 200 || result2.status === 201 || result2.status === 204) {
                await log(channel, "🎉 RESTART LANCÉ AVEC SUCCÈS (retry) !");
            } else {
                await log(channel, `❌ Échec restart après reconnexion (HTTP ${result2.status})\n\`\`\`${result2.body}\`\`\``);
            }
        } else {
            await log(channel, `❌ Échec restart (HTTP ${result.status})\n\`\`\`${result.body}\`\`\``);
        }

    } catch (err) {
        console.error("[RESTART ERREUR]", err);
        if (page) await screenshot(channel, "erreur-restart").catch(() => {});
        await log(channel, "❌ ERREUR restart: " + err.message);

        // Si le navigateur est cassé, on le relance
        isLoggedIn = false;
        try { await initBrowser(); } catch (_) {}
    }
}

// =======================
// STOP SYSTEM
// =======================
async function stopSystem(channel) {
    clearInterval(interval);
    interval = null;
    await log(channel, "🛑 Système arrêté.");
}

// =======================
// DISCORD BOT
// =======================
client.once("ready", () => {
    console.log(`✅ Bot connecté : ${client.user.tag}`);
    // Lancer le navigateur en arrière-plan SANS bloquer le bot
    initBrowser()
        .then(() => loginMinestrator(null))
        .catch((err) => console.error("[INIT ERREUR]", err.message));
});

client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    const channel = message.channel;

    if (message.content === "!start") {
        if (interval) return message.reply("⚠️ Le système est déjà actif !");
        await message.reply("🚀 Système activé ! Premier restart en cours...");
        await restartServer(channel);
        interval = setInterval(async () => {
            await log(channel, "⏱️ Restart automatique toutes les 3h...");
            await restartServer(channel);
        }, 3 * 60 * 60 * 1000);
    }

    if (message.content === "!stop") {
        await stopSystem(channel);
        await message.reply("🛑 Système arrêté.");
    }

    if (message.content === "!restart") {
        await message.reply("🔄 Restart manuel en cours...");
        await restartServer(channel);
    }

    if (message.content === "!status") {
        await message.reply(interval
            ? "✅ Système **actif** — restart auto toutes les 3h."
            : "🔴 Système **inactif** — tape `!start` pour démarrer."
        );
    }

    if (message.content === "!debug") {
        const serverId = (process.env.SERVER_URL || "").split("/").filter(Boolean).pop();
        await message.reply(
            `🔧 **Debug info:**\n` +
            `• SERVER_ID: \`${serverId || "❌ manquant"}\`\n` +
            `• EMAIL: ${process.env.MINESTRATOR_EMAIL ? "✅" : "❌ manquant"}\n` +
            `• PASSWORD: ${process.env.MINESTRATOR_PASSWORD ? "✅" : "❌ manquant"}\n` +
            `• Navigateur: ${browser ? "✅ actif" : "❌ inactif"}\n` +
            `• Session: ${isLoggedIn ? "✅ connecté" : "🔴 déconnecté"}\n` +
            `• Intervalle: ${interval ? "✅ actif" : "🔴 inactif"}`
        );
    }

    // Forcer reconnexion + screenshot
    if (message.content === "!login") {
        isLoggedIn = false;
        await loginMinestrator(channel);
    }

    // Screenshot de la page actuelle
    if (message.content === "!screen") {
        if (!page) return message.reply("❌ Navigateur non démarré.");
        await screenshot(channel, "capture-manuelle");
    }
});

client.login(process.env.DISCORD_TOKEN);
