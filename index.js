
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  PermissionsBitField
} = require("discord.js");

const OpenAI = require("openai");

const token = process.env.DISCORD_TOKEN;
const appId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;
const apiKey = process.env.OPENAI_API_KEY;

if (!token || !appId || !guildId || !apiKey) {
  throw new Error(
    "Configure DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID e OPENAI_API_KEY."
  );
}

const openai = new OpenAI({ apiKey });
const model = process.env.OPENAI_MODEL || "gpt-5.5";

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// Permissões que a IA pode conceder a cargos.
// Permissões administrativas e de gerenciamento ficam bloqueadas.
const ALLOWED_PERMISSIONS = {
  VerCanais: PermissionFlagsBits.ViewChannel,
  EnviarMensagens: PermissionFlagsBits.SendMessages,
  LerHistorico: PermissionFlagsBits.ReadMessageHistory,
  AnexarArquivos: PermissionFlagsBits.AttachFiles,
  IncorporarLinks: PermissionFlagsBits.EmbedLinks,
  AdicionarReacoes: PermissionFlagsBits.AddReactions,
  ConectarVoz: PermissionFlagsBits.Connect,
  FalarVoz: PermissionFlagsBits.Speak,
  UsarComandos: PermissionFlagsBits.UseApplicationCommands
};

const commands = [
  new SlashCommandBuilder()
    .setName("assistente")
    .setDescription("Peça à IA para ajudar a personalizar o servidor")
    .addStringOption(option =>
      option.setName("pedido")
        .setDescription("O que você quer fazer no servidor?")
        .setRequired(true)
        .setMaxLength(1000)
    ),

  new SlashCommandBuilder()
    .setName("ajuda")
    .setDescription("Mostra como usar o assistente")
].map(command => command.toJSON());

const tools = [
  {
    type: "function",
    name: "criar_categoria",
    description: "Cria uma categoria no servidor.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        nome: { type: "string" }
      },
      required: ["nome"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "criar_canal",
    description: "Cria um canal de texto ou voz.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        nome: { type: "string" },
        tipo: {
          type: "string",
          enum: ["texto", "voz"]
        },
        categoria: {
          type: ["string", "null"]
        }
      },
      required: ["nome", "tipo", "categoria"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "criar_cargo",
    description: "Cria um cargo sem permissões administrativas.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        nome: { type: "string" },
        cor: { type: "string" }
      },
      required: ["nome", "cor"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "editar_cargo",
    description: "Altera nome e/ou cor de um cargo existente.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        cargo: { type: "string" },
        novo_nome: { type: ["string", "null"] },
        cor: { type: ["string", "null"] }
      },
      required: ["cargo", "novo_nome", "cor"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "definir_permissoes_cargo",
    description:
      "Define as permissões permitidas de um cargo. A lista substitui as permissões anteriores.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        cargo: { type: "string" },
        permissoes: {
          type: "array",
          items: {
            type: "string",
            enum: Object.keys(ALLOWED_PERMISSIONS)
          }
        }
      },
      required: ["cargo", "permissoes"],
      additionalProperties: false
    }
  }
];

const instructions = `
Você é um assistente especializado em personalização de servidores Discord.
Responda em português brasileiro, com clareza.
Entenda os pedidos e use as funções disponíveis quando a pessoa pedir
uma alteração real no servidor.
Se a pessoa só fizer uma pergunta, responda sem executar funções.
Não invente que fez alterações se nenhuma função foi executada.
Não peça nem revele tokens ou chaves secretas.
Ao configurar permissões, use somente os nomes aceitos pelas funções.
Nunca tente contornar as regras de autorização do bot.
`;

function cleanName(value, max = 90) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, max);
}

function findRole(guild, name) {
  const query = name.trim().toLowerCase();
  return guild.roles.cache.find(
    role => role.name.toLowerCase() === query ||
            role.id === name.trim()
  );
}

function checkHex(color) {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    throw new Error("A cor precisa estar no formato #3498db.");
  }
}

async function executeTool(name, args, guild) {
  if (name === "criar_categoria") {
    const nome = cleanName(args.nome);
    if (!nome) throw new Error("Nome inválido.");

    const channel = await guild.channels.create({
      name: nome,
      type: ChannelType.GuildCategory,
      reason: "Solicitação do assistente de IA"
    });

    return { sucesso: true, categoria: channel.name };
  }

  if (name === "criar_canal") {
    const nome = cleanName(args.nome);
    if (!nome) throw new Error("Nome inválido.");

    let parent = null;
    if (args.categoria) {
      const category = guild.channels.cache.find(
        channel =>
          channel.type === ChannelType.GuildCategory &&
          channel.name.toLowerCase() ===
            args.categoria.trim().toLowerCase()
      );

      if (!category) throw new Error("Categoria não encontrada.");
      parent = category.id;
    }

    const channel = await guild.channels.create({
      name: nome,
      type: args.tipo === "voz"
        ? ChannelType.GuildVoice
        : ChannelType.GuildText,
      parent,
      reason: "Solicitação do assistente de IA"
    });

    return { sucesso: true, canal: channel.name };
  }

  if (name === "criar_cargo") {
    const nome = cleanName(args.nome);
    if (!nome) throw new Error("Nome inválido.");

    const color = args.cor || "#99AAB5";
    checkHex(color);

    const role = await guild.roles.create({
      name: nome,
      color,
      permissions: [],
      reason: "Solicitação do assistente de IA"
    });

    return { sucesso: true, cargo: role.name, cor: color };
  }

  if (name === "editar_cargo") {
    const role = findRole(guild, args.cargo);
    if (!role) throw new Error("Cargo não encontrado.");

    if (role.managed || role.id === guild.id) {
      throw new Error("Esse cargo não pode ser editado por esta função.");
    }

    const changes = {};

    if (args.novo_nome) {
      changes.name = cleanName(args.novo_nome);
    }

    if (args.cor) {
      checkHex(args.cor);
      changes.color = args.cor;
    }

    if (!Object.keys(changes).length) {
      throw new Error("Informe um novo nome ou uma cor.");
    }

    await role.edit({
      ...changes,
      reason: "Solicitação do assistente de IA"
    });

    return { sucesso: true, cargo: role.name };
  }

  if (name === "definir_permissoes_cargo") {
    const role = findRole(guild, args.cargo);
    if (!role) throw new Error("Cargo não encontrado.");

    if (role.managed || role.id === guild.id) {
      throw new Error("Esse cargo não pode ser alterado.");
    }

    const permissions = args.permissoes.map(permission => {
      const flag = ALLOWED_PERMISSIONS[permission];
      if (flag === undefined) {
        throw new Error("Permissão não permitida: " + permission);
      }
      return flag;
    });

    await role.setPermissions(
      new PermissionsBitField(permissions),
      "Permissões solicitadas pelo assistente de IA"
    );

    return {
      sucesso: true,
      cargo: role.name,
      permissoes: args.permissoes
    };
  }

  throw new Error("Função desconhecida.");
}

client.once("ready", () => {
  console.log(`Bot conectado como ${client.user.tag}`);
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "ajuda") {
    return interaction.reply({
      ephemeral: true,
      content:
        "Use `/assistente pedido:` e escreva o que deseja. " +
        "Exemplo: criar uma categoria EVENTOS e um canal avisos nela."
    });
  }

  if (interaction.commandName !== "assistente") return;

  await interaction.deferReply();

  try {
    // Somente membros com Gerenciar Servidor podem usar a IA
    // para executar pedidos. Perguntas comuns também exigem isso.
    if (!interaction.memberPermissions?.has(
      PermissionFlagsBits.ManageGuild
    )) {
      return interaction.editReply(
        "Você precisa da permissão **Gerenciar Servidor** para usar este assistente."
      );
    }

    const guild = interaction.guild;
    if (!guild) {
      return interaction.editReply("Use esse comando dentro de um servidor.");
    }

    const botMember = await guild.members.fetchMe();

    const prompt = interaction.options.getString("pedido", true);

    let response = await openai.responses.create({
      model,
      instructions,
      input: prompt,
      tools,
      max_output_tokens: 700
    });

    let executed = 0;

    // Limite de rodadas para evitar ciclos intermináveis.
    for (let round = 0; round < 3; round++) {
      const calls = response.output.filter(
        item => item.type === "function_call"
      );

      if (!calls.length) break;

      const outputs = [];

      for (const call of calls) {
        let result;

        try {
          const args = JSON.parse(call.arguments);

          // Verifica a permissão necessária antes de cada ação.
          const needed = {
            criar_categoria: PermissionFlagsBits.ManageChannels,
            criar_canal: PermissionFlagsBits.ManageChannels,
            criar_cargo: PermissionFlagsBits.ManageRoles,
            editar_cargo: PermissionFlagsBits.ManageRoles,
            definir_permissoes_cargo: PermissionFlagsBits.ManageRoles
          }[call.name];

          if (!needed || !botMember.permissions.has(needed)) {
            throw new Error("O bot não tem a permissão necessária.");
          }

          result = await executeTool(call.name, args, guild);
          executed++;
        } catch (error) {
          result = { sucesso: false, erro: error.message };
        }

        outputs.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify(result)
        });
      }

      response = await openai.responses.create({
        model,
        instructions,
        previous_response_id: response.id,
        input: outputs,
        tools,
        max_output_tokens: 700
      });
    }

    let answer = response.output_text || "Pedido processado.";
    if (answer.length > 1900) {
      answer = answer.slice(0, 1900) + "...";
    }

    if (executed > 0) {
      answer += "\n\nAlterações executadas: " + executed + ".";
    }

    await interaction.editReply(answer);
  } catch (error) {
    console.error("Erro no assistente:", error);
    await interaction.editReply(
      "Não consegui concluir o pedido. Confira as variáveis, " +
      "as permissões do bot e os logs do Railway."
    );
  }
});

async function start() {
  const rest = new REST({ version: "10" }).setToken(token);

  await rest.put(
    Routes.applicationGuildCommands(appId, guildId),
    { body: commands }
  );

  await client.login(token);
}

start().catch(error => {
  console.error("Falha ao iniciar:", error);
  process.exit(1);
});
