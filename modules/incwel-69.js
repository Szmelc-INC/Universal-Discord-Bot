const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const SEBUS_ID = '421333988834017290';
const TIMEOUT_MS = 60_000;

// Stan modułu (w pamięci procesu)
const state = {
  enabled: false,
  cycles: 0,          // łączna liczba nałożonych timeoutów
  registerA: 0,
  registerB: 0,
  isTimedOut: false,
  lastCycleAt: null
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sebusi')
    .setDescription('Kalkulator kwantowo-discordowy architektury incwel 69')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand(sub =>
      sub
        .setName('toggle')
        .setDescription('Włącza lub wyłącza tryb superpozycji Sebusia')
        .addStringOption(opt =>
          opt
            .setName('stan')
            .setDescription('on / off')
            .setRequired(true)
            .addChoices(
              { name: 'on', value: 'on' },
              { name: 'off', value: 'off' }
            )
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('memory')
        .setDescription('Odczyt stanu pamięci i rejestrów')
    )
    .addSubcommand(sub =>
      sub
        .setName('calculate')
        .setDescription('Wykonuje operację arytmetyczną na rejestrach A i B')
        .addStringOption(opt =>
          opt
            .setName('operacja')
            .setDescription('Operacja do wykonania')
            .setRequired(true)
            .addChoices(
              { name: 'dodawanie (A + B)', value: 'add' },
              { name: 'odejmowanie (A - B)', value: 'sub' },
              { name: 'mnożenie (A × B)', value: 'mul' },
              { name: 'dzielenie (A / B)', value: 'div' }
            )
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('set')
        .setDescription('Ręczne ustawienie wartości rejestru (do testów i przygotowania argumentów)')
        .addStringOption(opt =>
          opt
            .setName('rejestr')
            .setDescription('Rejestr docelowy')
            .setRequired(true)
            .addChoices(
              { name: 'A', value: 'A' },
              { name: 'B', value: 'B' }
            )
        )
        .addIntegerOption(opt =>
          opt
            .setName('wartosc')
            .setDescription('Wartość liczbowa')
            .setRequired(true)
            .setMinValue(0)
            .setMaxValue(10000)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('capture')
        .setDescription('Zapisuje aktualną liczbę cykli do wybranego rejestru i zeruje licznik cykli')
        .addStringOption(opt =>
          opt
            .setName('rejestr')
            .setDescription('Rejestr docelowy')
            .setRequired(true)
            .addChoices(
              { name: 'A', value: 'A' },
              { name: 'B', value: 'B' }
            )
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('release')
        .setDescription('Natychmiast zdejmuje timeout z Sebusia (jeśli aktywny)')
    ),

  async init(client) {
    // Nasłuchiwanie rozpoczęcia pisania
    client.on('typingStart', async (typing) => {
      if (!state.enabled) return;
      if (typing.user.id !== SEBUS_ID) return;

      const guild = typing.guild;
      if (!guild) return;

      try {
        const member = await guild.members.fetch(SEBUS_ID).catch(() => null);
        if (!member) return;

        // Nakładamy timeout tylko jeśli aktualnie nie jest nałożony
        if (!member.isCommunicationDisabled()) {
          await member.timeout(TIMEOUT_MS, 'incwel 69 – utrzymanie superpozycji');
          state.isTimedOut = true;
          state.cycles += 1;
          state.lastCycleAt = new Date().toISOString();
          console.log(`[sebusi] Cykl #${state.cycles} – timeout nałożony`);
        }
      } catch (err) {
        console.error('[sebusi] Błąd przy nakładaniu timeoutu:', err.message);
      }
    });

    // Przybliżone wykrycie zakończenia pisania – zdjęcie timeoutu po wysłaniu wiadomości
    client.on('messageCreate', async (message) => {
      if (!state.enabled) return;
      if (message.author.id !== SEBUS_ID) return;
      if (message.author.bot) return;

      try {
        const member = message.member;
        if (member && member.isCommunicationDisabled()) {
          await member.timeout(null, 'incwel 69 – zwolnienie po zakończeniu aktywności');
          state.isTimedOut = false;
          console.log('[sebusi] Timeout zdjęty po wiadomości');
        }
      } catch (err) {
        console.error('[sebusi] Błąd przy zdejmowaniu timeoutu:', err.message);
      }
    });

    console.log('[sebusi] Moduł zainicjalizowany – nasłuchiwanie zdarzeń typing i message');
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // Toggle
    if (sub === 'toggle') {
      const value = interaction.options.getString('stan');
      state.enabled = value === 'on';

      return interaction.reply({
        content: state.enabled
          ? 'Tryb superpozycji **włączony**. Bot będzie nakładał 60-sekundowy timeout przy każdym wykryciu pisania przez Sebusia.'
          : 'Tryb superpozycji **wyłączony**.',
        ephemeral: true
      });
    }

    // Memory read
    if (sub === 'memory') {
      const status = state.enabled ? 'aktywny' : 'nieaktywny';
      const last = state.lastCycleAt ? new Date(state.lastCycleAt).toLocaleString('pl-PL') : 'brak';

      const content = [
        '**Stan pamięci architektury incwel 69**',
        `• Tryb superpozycji: **${status}**`,
        `• Licznik cykli (łącznie): **${state.cycles}**`,
        `• Rejestr A: **${state.registerA}**`,
        `• Rejestr B: **${state.registerB}**`,
        `• Aktualny timeout: **${state.isTimedOut ? 'aktywny' : 'brak'}**`,
        `• Ostatni cykl: ${last}`
      ].join('\n');

      return interaction.reply({ content, ephemeral: true });
    }

    // Calculate
    if (sub === 'calculate') {
      const op = interaction.options.getString('operacja');
      const a = state.registerA;
      const b = state.registerB;
      let result;
      let symbol;

      switch (op) {
        case 'add':
          result = a + b;
          symbol = '+';
          break;
        case 'sub':
          result = a - b;
          symbol = '−';
          break;
        case 'mul':
          result = a * b;
          symbol = '×';
          break;
        case 'div':
          if (b === 0) {
            return interaction.reply({
              content: 'Błąd: dzielenie przez zero (rejestr B = 0).',
              ephemeral: true
            });
          }
          result = a / b;
          symbol = '÷';
          break;
        default:
          return interaction.reply({ content: 'Nieznana operacja.', ephemeral: true });
      }

      const content = [
        '**Wynik obliczenia w architekturze incwel 69**',
        `Operacja: \`${a} ${symbol} ${b}\``,
        `Wynik: **${result}**`
      ].join('\n');

      return interaction.reply({ content });
    }

    // Set register (pomocnicze)
    if (sub === 'set') {
      const reg = interaction.options.getString('rejestr');
      const value = interaction.options.getInteger('wartosc');

      if (reg === 'A') state.registerA = value;
      else state.registerB = value;

      return interaction.reply({
        content: `Rejestr **${reg}** ustawiony na wartość **${value}**.`,
        ephemeral: true
      });
    }

    // Capture cycles into register
    if (sub === 'capture') {
      const reg = interaction.options.getString('rejestr');
      const value = state.cycles;

      if (reg === 'A') state.registerA = value;
      else state.registerB = value;

      state.cycles = 0; // zerujemy licznik po przechwyceniu

      return interaction.reply({
        content: `Przechwycono **${value}** cykli do rejestru **${reg}**. Licznik cykli został wyzerowany.`,
        ephemeral: true
      });
    }

    // Force release
    if (sub === 'release') {
      try {
        const guild = interaction.guild;
        if (!guild) {
          return interaction.reply({ content: 'Komenda dostępna tylko na serwerze.', ephemeral: true });
        }

        const member = await guild.members.fetch(SEBUS_ID).catch(() => null);
        if (!member) {
          return interaction.reply({ content: 'Nie znaleziono użytkownika Sebuś na tym serwerze.', ephemeral: true });
        }

        if (member.isCommunicationDisabled()) {
          await member.timeout(null, 'incwel 69 – ręczne zwolnienie');
          state.isTimedOut = false;
          return interaction.reply({ content: 'Timeout został zdjęty.', ephemeral: true });
        }

        return interaction.reply({ content: 'Użytkownik nie jest obecnie w timeoutie.', ephemeral: true });
      } catch (err) {
        return interaction.reply({
          content: `Błąd podczas zdejmowania timeoutu: ${err.message}`,
          ephemeral: true
        });
      }
    }
  }
};
