require("dotenv").config();
const { Client, GatewayIntentBits, AttachmentBuilder, EmbedBuilder } = require("discord.js");
const puppeteer = require("puppeteer");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Options de navigation pour ressembler à un VRAI humain et éviter les blocages
const puppeteerOptions = {
    headless: "new",
    args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ]
};

// Fonction pour envoyer un message avec une capture d'écran sur Discord
async function sendScreenshot(channel, page, title, description) {
    // Petite attente pour être sûr que le rendu visuel est complètement chargé
    await new Promise(r => setTimeout(r, 3000));
    
    const screenshotBuffer = await page.screenshot({ fullPage: false });
    const attachment = new AttachmentBuilder(screenshotBuffer, { name: "panel-action.png" });
    
    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setImage("attachment://panel-action.png")
        .setColor(0x3498db)
        .setTimestamp();

    await channel.send({ embeds: [embed], files: [attachment] });
}

// ==========================================
// MOTEUR DE NAVIGATION ET CONNEXION RÉELLE
// ==========================================
async function runMinestratorAction(channel, actionName) {
    console.log(`[PUPPETEER] Lancement du navigateur pour l'action : ${actionName}`);
    const browser = await puppeteer.launch(puppeteerOptions);
    const page = await browser.newPage();
    
    // Taille d'écran d'un ordinateur classique
    await page.setViewport({ width: 1400, height: 900 });

    try {
        // 1. Aller sur la page de connexion
        await page.goto("https://minestrator.com/login", { waitUntil: "networkidle2" });

        // 2. Remplir les vrais champs de connexion
        await page.type('input[name="email"]', process.env.MINESTRATOR_EMAIL);
        await page.type('input[name="password"]', process.env.MINESTRATOR_PASSWORD);
        
        const rememberCheckbox = await page.$('input[name="remember"]');
        if (rememberCheckbox) await rememberCheckbox.click();

        // 3. Cliquer et attendre d'entrer sur le site
        await Promise.all([
            page.click('button[type="submit"]'),
            page.waitForNavigation({ waitUntil: "networkidle2" })
        ]);

        console.log("[PUPPETEER] Connexion réussie. Navigation vers l'URL du serveur...");
        
        // 4. Aller sur ton serveur (445749)
        await page.goto(process.env.SERVER_URL, { waitUntil: "networkidle2" });
        await page.waitForSelector("body", { timeout: 15000 });

        // Si l'utilisateur a juste demandé un screenshot (!screen)
        if (actionName === "screen") {
            await sendScreenshot(channel, page, "🖥️ Capture d'écran du Panel", "Voici l'état actuel visible sur ton compte Minestrator.");
            await browser.close();
            return true;
        }

        // 5. Recherche et clic sur le bouton d'action (Start ou Stop)
        const actionClicked = await page.evaluate((action) => {
            const elements = Array.from(document.querySelectorAll('button, a, span, i'));
            
            const keywords = {
                start: ['démarrer', 'start', 'fa-play'],
                stop: ['arrêter', 'stop', 'éteindre', 'kill', 'fa-stop']
            };

            const targets = keywords[action];
            
            for (const el of elements) {
                const text = el.textContent ? el.textContent.toLowerCase() : "";
                const html = el.innerHTML ? el.innerHTML.toLowerCase() : "";
                
                const matchFound = targets.some(target => text.includes(target) || html.includes(target));
                
                if (matchFound) {
                    const clickable = el.closest('button') || el.closest('a') || el;
                    clickable.click();
                    return true;
                }
            }
            return false;
        }, actionName);

        if (actionClicked) {
            // Attendre que l'action s'exécute à l'écran avant de prendre la photo
            await new Promise(r => setTimeout(r, 4000));
            await sendScreenshot(channel, page, `✅ Action ${actionName.toUpperCase()} effectuée`, `Le bouton a été cliqué. Voici le résultat en image :`);
        } else {
            await sendScreenshot(channel, page, `⚠️ Bouton introuvable`, `Le script s'est connecté mais n'a pas détecté le bouton pour faire "${actionName}". Voici ce qu'il voit :`);
        }

        await browser.close();
        return actionClicked;

    } catch (error) {
        console.error("[ERREUR DE NAVIGATION]", error);
        // En cas de crash, on essaie quand même de prendre une photo de l'erreur pour voir ce qui bloque (ex: un Captcha)
        try {
            await sendScreenshot(channel, page, "❌ Erreur de parcours", `Le script a bloqué. Voici une capture d'écran de l'état actuel : \n\`${error.message}\``);
        } catch (e) {
            await channel.send(`❌ Impossible de générer la capture d'écran de l'erreur : ${error.message}`);
        }
        await browser.close();
        return false;
    }
}

// ==========================================
// COMMANDES DISCORD
// ==========================================
client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.content.startsWith("!")) return;

    const command = message.content.toLowerCase();
    const ch = message.channel;

    if (command === "!screen") {
        await message.reply("📸 Connexion en cours à ton compte pour prendre une capture...");
        await runMinestratorAction(ch, "screen");
    }

    if (command === "!start") {
        await message.reply("⚡ Connexion et tentative de clic sur **Démarrer**...");
        await runMinestratorAction(ch, "start");
    }

    if (command === "!stop") {
        await message.reply("🛑 Connexion et tentative de clic sur **Arrêter**...");
        await runMinestratorAction(ch, "stop");
    }
});

client.once("ready", () => {
    console.log(`✅ Bot connecté : ${client.user.tag}`);
});

process.on("unhandledRejection", (reason) => console.error("[ANTI-CRASH]", reason));

client.login(process.env.DISCORD_TOKEN);