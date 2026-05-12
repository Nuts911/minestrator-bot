require("dotenv").config();
const { Client, GatewayIntentBits, AttachmentBuilder, EmbedBuilder } = require("discord.js");
const puppeteer = require("puppeteer");

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// Configuration Railway / Puppeteer
const BROWSER_OPTIONS = {
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
};

// --- MOTEUR DE NAVIGATION ---
async function getMinestratorScreenshot() {
    const browser = await puppeteer.launch(BROWSER_OPTIONS);
    const page = await browser.newPage();
    
    try {
        await page.setViewport({ width: 1280, height: 800 });

        // 1. Connexion
        await page.goto("https://minestrator.com/login", { waitUntil: "networkidle2" });
        await page.type('input[name="email"]', process.env.MINESTRATOR_EMAIL);
        await page.type('input[name="password"]', process.env.MINESTRATOR_PASSWORD);
        await page.click('button[type="submit"]');
        
        // Attendre la redirection sur le dashboard
        await page.waitForNavigation({ waitUntil: "networkidle2" });

        // 2. Aller sur le serveur spécifique
        await page.goto(process.env.SERVER_URL, { waitUntil: "networkidle2" });

        // 3. Prendre la photo
        // On attend que le panel de contrôle soit visible
        await page.waitForSelector("body"); 
        const screenshot = await page.screenshot({ fullPage: false });

        await browser.close();
        return screenshot;
    } catch (e) {
        await browser.close();
        throw e;
    }
}

async function runPowerAction(action) {
    const browser = await puppeteer.launch(BROWSER_OPTIONS);
    const page = await browser.newPage();
    
    try {
        await page.goto("https://minestrator.com/login", { waitUntil: "networkidle2" });
        await page.type('input[name="email"]', process.env.MINESTRATOR_EMAIL);
        await page.type('input[name="password"]', process.env.MINESTRATOR_PASSWORD);
        await page.click('button[type="submit"]');
        await page.waitForNavigation();

        await page.goto(process.env.SERVER_URL, { waitUntil: "networkidle2" });

        // On cherche le bouton spécifique (Start, Stop, ou Restart)
        // Note: Les sélecteurs dépendent du design de Minestrator
        const selectors = {
            "start": ".btn-success", 
            "stop": ".btn-danger",
            "restart": ".btn-primary"
        };

        await page.click(selectors[action.toLowerCase()]);
        await new Promise(r => setTimeout(r, 2000)); // Attendre que l'action soit prise en compte
        
        await browser.close();
        return true;
    } catch (e) {
        await browser.close();
        return false;
    }
}

// --- COMMANDES DISCORD ---

client.on("messageCreate", async (message) => {
    if (message.author.bot) return;

    // COMMANDE !SCREEN
    if (message.content === "!screen") {
        const msg = await message.reply("📸 Capture d'écran en cours (connexion à Minestrator)...");
        try {
            const buffer = await getMinestratorScreenshot();
            const attachment = new AttachmentBuilder(buffer, { name: "panel.png" });
            
            const embed = new EmbedBuilder()
                .setTitle("🖥️ Screenshot du Panel Minestrator")
                .setImage("attachment://panel.png")
                .setColor(0x00AE86)
                .setTimestamp();

            await msg.delete();
            await message.reply({ embeds: [embed], files: [attachment] });
        } catch (err) {
            console.error(err);
            await msg.edit("❌ Erreur : Impossible de prendre le screenshot. Vérifie tes identifiants.");
        }
    }

    // COMMANDES !START / !STOP
    if (message.content === "!start" || message.content === "!stop") {
        const action = message.content.replace("!", "");
        const msg = await message.reply(`⏳ Exécution de l'action **${action}** sur le panel...`);
        
        const success = await runPowerAction(action);
        if (success) {
            await msg.edit(`✅ Action **${action}** envoyée avec succès au serveur.`);
        } else {
            await msg.edit("❌ Échec de l'action. Le bouton n'a pas pu être cliqué.");
        }
    }
});

client.once("ready", () => console.log(`✅ Bot "Real-Panel" connecté : ${client.user.tag}`));
client.login(process.env.DISCORD_TOKEN);