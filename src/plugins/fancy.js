function makeAlphabetMap(source, target) {
    const sourceChars = Array.from(source);
    const targetChars = Array.isArray(target)
        ? target
        : Array.from(target);

    if (sourceChars.length !== targetChars.length) {
        throw new Error("Invalid fancy alphabet mapping.");
    }

    return Object.fromEntries(
        sourceChars.map((char, index) => [
            char,
            targetChars[index]
        ])
    );
}

function mapText(text, mapping) {
    return Array.from(text)
        .map(char => mapping[char] ?? char)
        .join("");
}

function rangeStyle(
    upperBase,
    lowerBase,
    digitBase = null,
    exceptions = {}
) {
    return text => Array.from(text).map(char => {
        if (exceptions[char]) return exceptions[char];

        const code = char.codePointAt(0);

        if (code >= 65 && code <= 90) {
            return String.fromCodePoint(
                upperBase + code - 65
            );
        }

        if (code >= 97 && code <= 122) {
            return String.fromCodePoint(
                lowerBase + code - 97
            );
        }

        if (
            digitBase !== null &&
            code >= 48 &&
            code <= 57
        ) {
            return String.fromCodePoint(
                digitBase + code - 48
            );
        }

        return char;
    }).join("");
}

const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const lower = "abcdefghijklmnopqrstuvwxyz";
const digits = "0123456789";

const greekUpper = [
    "Α", "Β", "Ϲ", "Δ", "Ε", "Ғ", "Η", "Θ", "Ι", "Κ",
    "ᒪ", "Μ", "Ν", "Ξ", "Ο", "Ρ", "Ϙ", "Σ", "Τ", "Ս",
    "Ѵ", "Ω", "Χ", "Ψ", "Ζ", "ϒ"
];

const greekLower = [
    "α", "Ь", "ϲ", "δ", "ε", "ғ", "η", "θ", "ι", "κ",
    "ℓ", "м", "п", "ξ", "ο", "ρ", "զ", "σ", "τ", "υ",
    "ν", "ω", "χ", "ψ", "ζ", "γ"
];

const phoneticUpper = [
    "Ⱥ", "Ƀ", "Ƈ", "Đ", "Ɇ", "Ƒ", "Ǥ", "Ħ", "Ɨ", "Ɉ",
    "Ҡ", "Ł", "Ɱ", "Ŋ", "Ø", "Ƥ", "Ɋ", "Ɍ", "Ş", "Ŧ",
    "Ʉ", "Ṽ", "Ŵ", "Ӿ", "Ɏ", "Ƶ"
];

const phoneticLower = [
    "ɑ", "ɓ", "ɔ", "ɗ", "ɛ", "ƒ", "ɠ", "ɦ", "ɨ", "ʝ",
    "ƙ", "ɭ", "ɱ", "ŋ", "ɵ", "ƥ", "ɋ", "ɾ", "ʂ", "ʈ",
    "ʊ", "ʋ", "ɯ", "χ", "ʎ", "ʐ"
];

const katakana = [
    "ア", "ビ", "ク", "デ", "エ", "フ", "グ", "ハ", "イ", "ジ",
    "カ", "ル", "ム", "ン", "オ", "プ", "ク", "ラ", "ス", "ト",
    "ウ", "ヴ", "ワ", "エ", "ユ", "ズ"
];

const cherokee = [
    "Ꭺ", "Ᏼ", "Ꮯ", "Ꭰ", "Ꭼ", "Ꮀ", "Ꮐ", "Ꮋ", "Ꭵ", "Ꮣ",
    "Ꮶ", "Ꮮ", "Ꮇ", "Ꮑ", "Ꮎ", "Ꮲ", "Ꮕ", "Ꮢ", "Ꮪ", "Ꭲ",
    "Ꮜ", "Ꮤ", "Ꮃ", "Ᏼ", "Ꮓ", "Ꮓ"
];

const thai = [
    "ก", "ข", "ค", "ง", "จ", "ฉ", "ช", "ซ", "ญ", "ฎ",
    "ด", "ต", "ถ", "ท", "น", "บ", "ป", "ผ", "ฝ", "พ",
    "ฟ", "ม", "ย", "ร", "ล", "ว"
];

const smallCaps = [
    "ᴀ", "ʙ", "ᴄ", "ᴅ", "ᴇ", "ғ", "ɢ", "ʜ", "ɪ", "ᴊ",
    "ᴋ", "ʟ", "ᴍ", "ɴ", "ᴏ", "ᴘ", "ǫ", "ʀ", "s", "ᴛ",
    "ᴜ", "ᴠ", "ᴡ", "x", "ʏ", "ᴢ"
];

const greekMap = {
    ...makeAlphabetMap(upper, greekUpper),
    ...makeAlphabetMap(lower, greekLower)
};

const phoneticMap = {
    ...makeAlphabetMap(upper, phoneticUpper),
    ...makeAlphabetMap(lower, phoneticLower)
};

const katakanaMap = {
    ...makeAlphabetMap(upper, katakana),
    ...makeAlphabetMap(lower, katakana)
};

const cherokeeMap = {
    ...makeAlphabetMap(upper, cherokee),
    ...makeAlphabetMap(lower, cherokee)
};

const thaiMap = {
    ...makeAlphabetMap(upper, thai),
    ...makeAlphabetMap(lower, thai)
};

const smallCapsMap = {
    ...makeAlphabetMap(lower, smallCaps),
    ...makeAlphabetMap(upper, smallCaps)
};

const circledMap = {
    ...makeAlphabetMap(
        upper,
        Array.from({ length: 26 }, (_, i) =>
            String.fromCodePoint(0x24B6 + i)
        )
    ),
    ...makeAlphabetMap(
        lower,
        Array.from({ length: 26 }, (_, i) =>
            String.fromCodePoint(0x24D0 + i)
        )
    ),
    ...makeAlphabetMap(
        digits,
        ["⓪", "①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨"]
    )
};

const squaredMap = {
    ...makeAlphabetMap(
        upper,
        Array.from({ length: 26 }, (_, i) =>
            String.fromCodePoint(0x1F130 + i)
        )
    )
};

const negativeSquaredMap = {
    ...makeAlphabetMap(
        upper,
        Array.from({ length: 26 }, (_, i) =>
            String.fromCodePoint(0x1F170 + i)
        )
    )
};

const currencyMap = {
    A: "₳", B: "฿", C: "₵", D: "Đ", E: "€",
    F: "₣", G: "₲", H: "Ħ", I: "ł", J: "Ɉ",
    K: "₭", L: "£", M: "₥", N: "₦", O: "Ø",
    P: "₱", Q: "Ǫ", R: "₹", S: "$", T: "₮",
    U: "Ʉ", V: "Ѵ", W: "₩", X: "Ӿ", Y: "¥",
    Z: "Ƶ"
};

const mixedMap = {
    A: "Λ", B: "Ɓ", C: "Ƈ", D: "Ð", E: "Ξ",
    F: "Ғ", G: "Ɠ", H: "Ħ", I: "Ι", J: "Ј",
    K: "Ҡ", L: "Ł", M: "Μ", N: "И", O: "Θ",
    P: "Ρ", Q: "Ǫ", R: "Я", S: "Ѕ", T: "Τ",
    U: "Ц", V: "Ѵ", W: "Ш", X: "Ж", Y: "Ү",
    Z: "Ζ"
};

const subscriptMap = {
    a: "ₐ", e: "ₑ", h: "ₕ", i: "ᵢ", j: "ⱼ",
    k: "ₖ", l: "ₗ", m: "ₘ", n: "ₙ", o: "ₒ",
    p: "ₚ", r: "ᵣ", s: "ₛ", t: "ₜ", u: "ᵤ",
    v: "ᵥ", x: "ₓ",
    "0": "₀", "1": "₁", "2": "₂", "3": "₃",
    "4": "₄", "5": "₅", "6": "₆", "7": "₇",
    "8": "₈", "9": "₉"
};

const superscriptMap = {
    a: "ᵃ", b: "ᵇ", c: "ᶜ", d: "ᵈ", e: "ᵉ",
    f: "ᶠ", g: "ᵍ", h: "ʰ", i: "ⁱ", j: "ʲ",
    k: "ᵏ", l: "ˡ", m: "ᵐ", n: "ⁿ", o: "ᵒ",
    p: "ᵖ", r: "ʳ", s: "ˢ", t: "ᵗ", u: "ᵘ",
    v: "ᵛ", w: "ʷ", x: "ˣ", y: "ʸ", z: "ᶻ",
    "0": "⁰", "1": "¹", "2": "²", "3": "³",
    "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷",
    "8": "⁸", "9": "⁹"
};

const upsideDownMap = {
    a: "ɐ", b: "q", c: "ɔ", d: "p", e: "ǝ",
    f: "ɟ", g: "ƃ", h: "ɥ", i: "ᴉ", j: "ɾ",
    k: "ʞ", l: "ן", m: "ɯ", n: "u", o: "o",
    p: "d", q: "b", r: "ɹ", s: "s", t: "ʇ",
    u: "n", v: "ʌ", w: "ʍ", x: "x", y: "ʎ",
    z: "z",
    A: "∀", B: "𐐒", C: "Ɔ", D: "◖", E: "Ǝ",
    F: "Ⅎ", G: "פ", H: "H", I: "I", J: "ſ",
    K: "⋊", L: "˥", M: "W", N: "N", O: "O",
    P: "Ԁ", Q: "Ό", R: "ᴚ", S: "S", T: "⊥",
    U: "∩", V: "Λ", W: "M", X: "X", Y: "⅄",
    Z: "Z"
};

function addMarks(text, mark) {
    return Array.from(text)
        .map(char => /[A-Za-z]/.test(char) ? char + mark : char)
        .join("");
}

export const fancyStyles = [
    {
        name: "Greek-inspired",
        transform: text => mapText(text, greekMap)
    },
    {
        name: "Phonetic",
        transform: text => mapText(text, phoneticMap)
    },
    {
        name: "Katakana-inspired",
        transform: text => mapText(text, katakanaMap)
    },
    {
        name: "Squared",
        transform: text => mapText(text, {
            ...squaredMap,
            ...makeAlphabetMap(lower, smallCaps)
        })
    },
    {
        name: "Outlined",
        transform: text => mapText(text, circledMap)
    },
    {
        name: "Cherokee-inspired",
        transform: text => mapText(text, cherokeeMap)
    },
    {
        name: "Negative squared",
        transform: text => mapText(text, {
            ...negativeSquaredMap,
            ...makeAlphabetMap(lower, smallCaps)
        })
    },
    {
        name: "Decorative phonetic",
        transform: text => mapText(text, {
            ...phoneticMap,
            a: "ɑ", e: "ɛ", i: "ɪ", o: "ɵ",
            u: "ʊ", r: "ɾ", s: "ʂ"
        })
    },
    {
        name: "Monospace",
        transform: rangeStyle(0x1D670, 0x1D68A, 0x1D7F6)
    },
    {
        name: "Bold italic serif",
        transform: rangeStyle(0x1D468, 0x1D482)
    },
    {
        name: "Bold serif",
        transform: rangeStyle(0x1D400, 0x1D41A, 0x1D7CE)
    },
    {
        name: "Sans bold",
        transform: rangeStyle(0x1D5D4, 0x1D5EE, 0x1D7EC)
    },
    {
        name: "Sans italic",
        transform: rangeStyle(0x1D608, 0x1D622)
    },
    {
        name: "Mixed alphabet",
        transform: text => mapText(text, {
            ...mixedMap,
            ...Object.fromEntries(
                Object.entries(mixedMap).map(([key, value]) => [
                    key.toLowerCase(),
                    value.toLowerCase()
                ])
            )
        })
    },
    {
        name: "Currency symbols",
        transform: text => mapText(text, {
            ...currencyMap,
            ...Object.fromEntries(
                Object.entries(currencyMap).map(([key, value]) => [
                    key.toLowerCase(),
                    value
                ])
            )
        })
    },
    {
        name: "Greek variation",
        transform: text => mapText(text, {
            ...greekMap,
            a: "α", b: "β", c: "ς", d: "δ",
            e: "ε", f: "φ", g: "γ", h: "η",
            i: "ι", k: "κ", l: "λ", m: "μ",
            n: "ν", o: "ο", p: "π", r: "ρ",
            s: "σ", t: "τ", u: "υ", x: "χ",
            y: "ψ", z: "ζ"
        })
    },
    {
        name: "Wave decoration",
        transform: text => addMarks(text, "\u0330")
    },
    {
        name: "Greek lowercase",
        transform: text => mapText(text, {
            ...greekMap,
            ...makeAlphabetMap(lower, [
                "α", "β", "ς", "δ", "ε", "φ", "γ", "η", "ι", "ξ",
                "κ", "λ", "μ", "ν", "ο", "π", "θ", "ρ", "σ", "τ",
                "υ", "ω", "χ", "ψ", "ζ", "ϟ"
            ])
        })
    },
    {
        name: "Subscript",
        transform: text => mapText(text, subscriptMap)
    },
    {
        name: "Superscript",
        transform: text => mapText(text, superscriptMap)
    },
    {
        name: "Thai-inspired",
        transform: text => mapText(text, thaiMap)
    },
    {
        name: "Double-struck",
        transform: rangeStyle(
            0x1D538,
            0x1D552,
            0x1D7D8,
            {
                C: "ℂ", H: "ℍ", N: "ℕ", P: "ℙ",
                Q: "ℚ", R: "ℝ", Z: "ℤ",
                e: "ℯ", g: "ℊ", o: "ℴ"
            }
        )
    },
    {
        name: "Bold Fraktur",
        transform: rangeStyle(0x1D56C, 0x1D586)
    },
    {
        name: "Negative alphabet",
        transform: text => mapText(text, {
            ...negativeSquaredMap,
            ...makeAlphabetMap(lower, Array.from(
                { length: 26 },
                (_, i) => String.fromCodePoint(0x24D0 + i)
            ))
        })
    },
    {
        name: "Bold script",
        transform: rangeStyle(0x1D4D0, 0x1D4EA)
    },
    {
        name: "Fraktur",
        transform: rangeStyle(
            0x1D504,
            0x1D51E,
            null,
            {
                C: "ℭ", H: "ℌ", I: "ℑ",
                R: "ℜ", Z: "ℨ"
            }
        )
    },
    {
        name: "Fullwidth",
        transform: rangeStyle(0xFF21, 0xFF41, 0xFF10)
    },
    {
        name: "Small caps",
        transform: text => mapText(text, smallCapsMap)
    },
    {
        name: "Italic serif",
        transform: rangeStyle(
            0x1D434,
            0x1D44E,
            null,
            { h: "ℎ" }
        )
    },
    {
        name: "Sans bold italic",
        transform: rangeStyle(0x1D63C, 0x1D656)
    }
];

export const fancy = {
    name: "fancy",
    aliases: [],
    category: "TOOLS",
    description: "Convert text into 30 fancy styles",

    async execute(sock, message, args) {
        const jid = message.key.remoteJid;

        if (!Array.isArray(args) || args.length < 2) {
            return sock.sendMessage(
                jid,
                {
                    text:
                        "FANCY TEXT GENERATOR\n\n" +
                        "Usage: .fancy text style-number\n\n" +
                        "Example: .fancy BLIX-XER 3\n" +
                        "Available styles: 1-30"
                },
                { quoted: message }
            );
        }

        const styleNumber = Number(args[args.length - 1]);
        const text = args.slice(0, -1).join(" ").trim();

        if (!text) {
            return sock.sendMessage(
                jid,
                { text: "Please provide text to convert." },
                { quoted: message }
            );
        }

        if (
            !Number.isInteger(styleNumber) ||
            styleNumber < 1 ||
            styleNumber > fancyStyles.length
        ) {
            return sock.sendMessage(
                jid,
                {
                    text: "Invalid style number. Choose a number from 1 to 30."
                },
                { quoted: message }
            );
        }

        const style = fancyStyles[styleNumber - 1];
        const result = style.transform(text);

        return sock.sendMessage(
            jid,
            { text: result },
            { quoted: message }
        );
    }
};
