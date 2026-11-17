function unwrapMessage(message) {
    let content = message;

    for (let i = 0; i < 10; i++) {
        const wrapped =
            content?.ephemeralMessage?.message ||
            content?.viewOnceMessage?.message ||
            content?.viewOnceMessageV2?.message ||
            content?.viewOnceMessageV2Extension?.message;

        if (!wrapped) break;
        content = wrapped;
    }

    return content;
}

function isViewOnce(message) {
    if (!message) return false;

    if (
        message.viewOnceMessage ||
        message.viewOnceMessageV2 ||
        message.viewOnceMessageV2Extension
    ) {
        return true;
    }

    const content = unwrapMessage(message);

    return Boolean(
        content?.imageMessage?.viewOnce ||
        content?.videoMessage?.viewOnce
    );
}

export const vv = {
    name: "vv",

    async execute(sock, message) {
        const jid = message.key.remoteJid;
        const content = unwrapMessage(message.message);

        const contextInfo =
            content?.extendedTextMessage?.contextInfo ||
            content?.imageMessage?.contextInfo ||
            content?.videoMessage?.contextInfo;

        const quotedMessage = contextInfo?.quotedMessage;

        if (!quotedMessage || !isViewOnce(quotedMessage)) {
            return sock.sendMessage(
                jid,
                {
                    text: "Reply to a View Once photo or video with .vv"
                },
                { quoted: message }
            );
        }

        return sock.sendMessage(
            jid,
            {
                text: "*_SPIDER-MD/BLIX-XER_*"
            },
            { quoted: message }
        );
    }
};
