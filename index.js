
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

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

if (!TOKEN || !CLIENT_ID || !API_KEY) {
  throw new Error(
    "Configure DISCORD_TOKEN, DISCORD_CLIENT_ID e OPENAI_API_KEY."
  );
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const openai = new OpenAI({ apiKey: API_KEY });

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
    .setDescription("Converse com a IA e personalize este servidor")
    .addStringOption(option =>
      option
        .setName("pedido")
        .setDescription("Escreva o que deseja fazer")
        .setRequired(true)
        .setMaxLength(1000)
    ),

  new SlashCommandBuilder()
    .setName("ajuda")
    .setDescription("Mostra os comandos do assistente")
].map(command => command.toJSON());

const aiTools = [
  {
    type: "function",
    name: "criar_categoria",
    description: "Cria uma categoria no servidor atual.",
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
    description: "Cria um cargo sem permissões especiais.",
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
    description: "Muda o nome ou a cor de um cargo existente.",
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
    description: "Define permissões de uma lista limitada para um cargo.",
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
Você é um assistente de IA para personalizar servidores Discord.
Responda sempre em português brasileiro.
Entenda pedidos escritos naturalmente.
Use as funções quando o usuário solicitar alterações reais.
Responda perguntas normalmente quando não for necessária uma alteração.
Nunca diga que realizou uma ação se ela falhou.
Use somente as funções disponíveis.
Não peça nem revele tokens ou chaves secretas.
Não tente contornar as permissões do usuário ou do bot.
Explique claramente os erros e os resultados das alterações.
`;

function cleanName(value) {
  return String(value || "").trim().slice(0, 90);
}

function validateColor(color) {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    throw new Error("Use uma cor hexadecimal, por exemplo #3498db.");
  }
}

function findRole(guild, name) {
  const value = name.trim().toLowerCase();

  return guild.roles.cache.find(role =>
    role.id === name.trim() ||
    role.name.toLowerCase() === value
  );
}

async function executeTool(name, args, guild) {
  if (name === "criar_categoria") {
    const nome = cleanName(args.nome);

    if (!nome) throw new Error("Nome inválido.");

    const category = await guild.channels.create({
      name: nome,
      type: ChannelType.GuildCategory,
      reason: "Solicitado pelo assistente de IA"
    });

    return {
      sucesso: true,
      mensagem: `Categoria ${category.name} criada.`
    };
  }

  if (name === "criar_canal") {
    const nome = cleanName(args.nome);

    if (!nome) throw new Error("Nome inválido.");

    let parent = null;

    if (args.categoria) {
      const category = guild.channels.cache.find(channel =>
        channel.type === ChannelType.GuildCategory &&
        channel.name.toLowerCase() ===
          args.categoria.trim().toLowerCase()
      );

      if (!category) {
        throw new Error("Categoria não encontrada.");
      }

      parent = category.id;
    }

    const channel = await guild.channels.create({
      name: nome,
      type: args.tipo === "voz"
        ? ChannelType.GuildVoice
        : ChannelType.GuildText,
      parent,
      reason: "Solicitado pelo assistente de IA"
    });

    return {
      sucesso: true,
      mensagem: `Canal ${channel.name} criado.`
    };
  }

  if (name === "criar_cargo") {
    const nome = cleanName(args.nome);
    const cor = args.cor || "#99AAB5";

    if (!nome) throw new Error("Nome inválido.");
    validateColor(cor);

    const role = await guild.roles.create({
      name: nome,
      color: cor,
      permissions: [],
      reason: "Solicitado pelo assistente de IA"
    });

    return {
      sucesso: true,
      mensagem: `Cargo ${role.name} criado na cor ${cor}.`
    };
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
      validateColor(args.cor);
      changes.color = args.cor;
    }

    if (!Object.keys(changes).length) {
      throw new Error("Informe o novo nome ou a nova cor.");
    }

    await role.edit({
      ...changes,
      reason: "Solicitado pelo assistente de IA"
    });

    return {
      sucesso: true,
      mensagem: `Cargo atualizado: ${role.name}.`
    };
  }

  if (name === "definir_permissoes_cargo") {
    const role = findRole(guild, args.cargo);

    if (!role) throw new Error("Cargo não encontrado.");

    if (role.managed || role.id === guild.id) {
      throw new Error("Esse cargo não pode ser editado.");
    }

    const permissions = args.permissoes.map(permission => {
      const flag = ALLOWED_PERMISSIONS[permission];

      if (flag === undefined) {
        throw new Error(`Permissão não permitida: ${permission}`);
      }

      return flag;
    });

    await role.setPermissions(
      new PermissionsBitField(permissions),
      "Solicitado pelo assistente de IA"
    );

    return {
      sucesso: true,
      mensagem:
        `Permissões atualizadas para ${role.name}: ` +
        (args.permissoes.join(", ") || "nenhuma permissão da lista")
    };
  }

  throw new Error("Ação não reconhecida.");
}

client.once("ready", () => {
  console.log(`Bot online: ${client.user.tag}`);
  console.log(`Servidores conectados: ${client.guilds.cache.size}`);
});

client.on("guildCreate", guild => {
  console.log(`Bot adicionado ao servidor: ${guild.name} (${guild.id})`);
});

client.on("guildDelete", guild => {
  console.log(`Bot removido do servidor: ${guild.id}`);
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "ajuda") {
    return interaction.reply({
      ephemeral: true,
      content:
        "Use `/assistente pedido:` para conversar com a IA.\n\n" +
        "Exemplos:\n" +
        "• Cria uma categoria EVENTOS.\n" +
        "• Cria um canal avisos na categoria EVENTOS.\n" +
        "• Cria um cargo VIP azul.\n" +
        "• Muda a cor do cargo VIP para roxo.\n" +
        "• Como posso organizar meu servidor?"
    });
  }

  if (interaction.commandName !== "assistente") return;

  await interaction.deferReply();

  try {
    if (!interaction.guild) {
      return interaction.editReply(
        "Use este comando dentro de um servidor Discord."
      );
    }

    if (!interaction.memberPermissions?.has(
      PermissionFlagsBits.ManageGuild
    )) {
      return interaction.editReply(
        "Você precisa da permissão **Gerenciar Servidor** " +
        "para utilizar o assistente."
      );
    }

    const guild = interaction.guild;
    const botMember = await guild.members.fetchMe();

    const prompt = interaction.options.getString("pedido", true);

    let response = await openai.responses.create({
      model: MODEL,
      instructions,
      input: prompt,
      tools: aiTools,
      max_output_tokens: 800
    });

    let executed = 0;
    const results = [];

    for (let round = 0; round < 4; round++) {
      const calls = response.output.filter(
        item => item.type === "function_call"
      );

      if (!calls.length) break;

      const outputs = [];

      for (const call of calls) {
        let result;

        try {
          const args = JSON.parse(call.arguments);

          const requiredPermission = {
            criar_categoria: PermissionFlagsBits.ManageChannels,
            criar_canal: PermissionFlagsBits.ManageChannels,
            criar_cargo: PermissionFlagsBits.ManageRoles,
            editar_cargo: PermissionFlagsBits.ManageRoles,
            definir_permissoes_cargo: PermissionFlagsBits.ManageRoles
          }[call.name];

          if (
            requiredPermission === undefined ||
            !botMember.permissions.has(requiredPermission)
          ) {
            throw new Error(
              "O bot não possui a permissão necessária."
            );
          }

          result = await executeTool(call.name, args, guild);

          if (result.sucesso) {
            executed++;
            results.push(result.mensagem);
          }
        } catch (error) {
          result = {
            sucesso: false,
            erro: error.message || "Erro ao executar a ação."
          };

          results.push(`Falha: ${result.erro}`);
        }

        outputs.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify(result)
        });
      }

      response = await openai.responses.create({
        model: MODEL,
        instructions,
        previous_response_id: response.id,
        input: outputs,
        tools: aiTools,
        max_output_tokens: 800
      });
    }

    let answer = response.output_text || "Pedido analisado.";

    if (results.length) {
      answer += "\n\n**Resultado das ações:**\n" +
        results.map(item => `• ${item}`).join("\n");
    }

    if (answer.length > 1900) {
      answer = answer.slice(0, 1900) + "...";
    }

    await interaction.editReply(answer);
  } catch (error) {
    console.error("Erro no assistente:", error);

    await interaction.editReply(
      "Não consegui concluir o pedido. Confira as chaves, " +
      "as permissões e os logs do Railway."
    );
  }
});

async function start() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  // REGISTRO GLOBAL: não usa ID de servidor.
  await rest.put(
    Routes.applicationCommands(CLIENT_ID),
    { body: commands }
  );

  console.log("Comandos globais registrados.");

  await client.login(TOKEN);
}

start().catch(error => {
  console.error("Erro ao iniciar o bot:", error);
  process.exit(1);
});
        
