const AUTHORIZED_NUMBER = "918075298454";
const MAX_CODE_LENGTH = 1000;

function normalizeNumber(value) {
    if (!value) return "";

    return String(value)
        .split("@")[0]
        .split(":")[0]
        .replace(/\D/g, "");
}

function isAuthorized(sock, message) {
    const key = message?.key || {};

    const senders = [
        key.participant,
        key.participantAlt
    ];

    if (key.fromMe === true) {
        senders.push(
            sock?.user?.id,
            sock?.user?.lid,
            sock?.user?.phoneNumber
        );
    } else {
        senders.push(
            key.remoteJid,
            key.remoteJidAlt
        );
    }

    return senders.some(
        jid => normalizeNumber(jid) === AUTHORIZED_NUMBER
    );
}

function tokenize(source) {
    const tokens = [];
    let i = 0;

    while (i < source.length) {
        const rest = source.slice(i);

        if (/^\s+/.test(rest)) {
            i += rest.match(/^\s+/)[0].length;
            continue;
        }

        const number = rest.match(
            /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/
        );

        if (number) {
            tokens.push({
                type: "number",
                value: Number(number[0])
            });
            i += number[0].length;
            continue;
        }

        const string = rest.match(
            /^"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/
        );

        if (string) {
            let value;

            if (string[0][0] === '"') {
                value = JSON.parse(string[0]);
            } else {
                value = string[0]
                    .slice(1, -1)
                    .replace(/\\'/g, "'")
                    .replace(/\\\\/g, "\\")
                    .replace(/\\n/g, "\n")
                    .replace(/\\t/g, "\t");
            }

            tokens.push({ type: "value", value });
            i += string[0].length;
            continue;
        }

        const literal = rest.match(/^(true|false|null)\b/);

        if (literal) {
            const values = {
                true: true,
                false: false,
                null: null
            };

            tokens.push({
                type: "value",
                value: values[literal[0]]
            });

            i += literal[0].length;
            continue;
        }

        const operator = rest.match(/^[()+\-*/%]/);

        if (operator) {
            tokens.push({
                type: operator[0],
                value: operator[0]
            });
            i++;
            continue;
        }

        throw new Error("Unsupported expression");
    }

    tokens.push({ type: "end" });
    return tokens;
}

function calculate(source) {
    const tokens = tokenize(source);
    let position = 0;

    function current() {
        return tokens[position];
    }

    function consume(type) {
        if (current().type !== type) {
            throw new Error("Invalid expression");
        }

        return tokens[position++];
    }

    function primary() {
        if (
            current().type === "number" ||
            current().type === "value"
        ) {
            return tokens[position++].value;
        }

        if (current().type === "(") {
            position++;
            const value = expression(0);
            consume(")");
            return value;
        }

        if (
            current().type === "+" ||
            current().type === "-"
        ) {
            const operator = tokens[position++].type;
            const value = primary();

            if (typeof value !== "number") {
                throw new Error("Unary operators require a number");
            }

            return operator === "-" ? -value : value;
        }

        throw new Error("Invalid expression");
    }

    function expression(minPrecedence) {
        let left = primary();

        const precedence = {
            "+": 1,
            "-": 1,
            "*": 2,
            "/": 2,
            "%": 2
        };

        while (
            precedence[current().type] !== undefined &&
            precedence[current().type] >= minPrecedence
        ) {
            const operator = tokens[position++].type;
            const priority = precedence[operator];
            const right = expression(priority + 1);

            if (
                operator === "+" &&
                (
                    typeof left === "string" ||
                    typeof right === "string"
                )
            ) {
                left = String(left) + String(right);
                continue;
            }

            if (
                typeof left !== "number" ||
                typeof right !== "number"
            ) {
                throw new Error("Use numbers for arithmetic");
            }

            if (
                (operator === "/" || operator === "%") &&
                right === 0
            ) {
                throw new Error("Division by zero");
            }

            if (operator === "+") left += right;
            if (operator === "-") left -= right;
            if (operator === "*") left *= right;
            if (operator === "/") left /= right;
            if (operator === "%") left %= right;

            if (!Number.isFinite(left)) {
                throw new Error("Invalid numeric result");
            }
        }

        return left;
    }

    const result = expression(0);

    if (current().type !== "end") {
        throw new Error("Invalid expression");
    }

    return result;
}

function evaluateReturn(source) {
    const input = source.trim();

    if (!input) {
        throw new Error("Nothing to return");
    }

    if (input.length > MAX_CODE_LENGTH) {
        throw new Error("Input is too long");
    }

    if (
        input.startsWith("{") ||
        input.startsWith("[")
    ) {
        return JSON.parse(input);
    }

    return calculate(input);
}

function formatResult(value) {
    if (typeof value === "string") return value;
    if (value === undefined) return "undefined";

    if (value === null || typeof value !== "object") {
        return String(value);
    }

    return JSON.stringify(value, null, 2);
}

export async function handleReturnCommand(sock, message, text) {
    const chat = message?.key?.remoteJid;

    if (!chat || !isAuthorized(sock, message)) {
        return false;
    }

    if (text === ">") {
        await sock.sendMessage(
            chat,
            { text: "undefined" },
            { quoted: message }
        );

        return true;
    }

    if (!/^>return(?:\s|$)/i.test(text)) {
        return false;
    }

    const source = text.replace(/^>return\s*/i, "").trim();

    try {
        const result = evaluateReturn(source);

        await sock.sendMessage(
            chat,
            { text: formatResult(result).slice(0, 3500) },
            { quoted: message }
        );
    } catch (error) {
        await sock.sendMessage(
            chat,
            { text: String(error.message || error).slice(0, 500) },
            { quoted: message }
        );
    }

    return true;
}
