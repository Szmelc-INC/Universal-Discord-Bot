# Kalkulator Kwantowy "incwel 69" na Discordzie
### Opracowanie bota realizującego operacje logiczne na bazie timeoutów użytkownika.
> Zapis brutalnie szczerej i shitpostowej rozkminy na temat zbudowania kalkulatora "kwantowego", którego jedynym kubitem i nośnikiem stanu jest wkurwiony kolega z Discorda (Sebuś). Koncepcja ewoluuje od założeń czysto fizycznych (Qiskit) po stworzenie w pełni funkcjonalnego modułu do bota w Node.js, który automatycznymi timeoutami symuluje "superpozycję" i liczy baity w architekturze "incwel 69".

---

## Index
### Teoria Kwantowa i Klasyczna (Realna)
- **Komputer Jednokubitowy (Hardware)**: Fizyczne wymogi (milikelwiny, próżnia) blokują domowe eksperymenty; opcje to układy nadprzewodzące, uwięzione jony, kropki kwantowe i NMR.
- **Symulacje i Optyka**: Rekomendowane środowisko Qiskit/Cirq w Pythonie do symulacji lub analog optyczny (laser 650nm, polaryzatory liniowe/falowe).
### Architektura "incwel 69" (Model Discordowy)
- **Mechanizm Superpozycji**: Bot nakłada 60-sekundowy timeout po evencie `typingStart` (stan 1) i zdejmuje po `messageCreate` (stan 0).
- **Protokół Obliczeniowy**: Zliczanie pełnych cykli (0->1->0) wymuszonych przez "baity" od Sernika w zdefiniowanych oknach czasowych.
### Kod i Implementacja Bota
- **Baza Bota Node.js**: Architektura modułowa, `discord.js` v14, dynamiczne ładowanie komend slash, pełna konteneryzacja (Docker).
- **Moduł `sebusi.js`**: Implementacja maszyny stanów z rejestrami A i B, systemem poleceń do zarządzania cyklami timeoutów Sebusia.

---

## Important Questions
### Projektowanie Architektury
- **Jak zrobić komputer kwantowy na 1 kubicie?**: Analiza fizycznych wymagań (Kryteria DiVincenzo) oraz udowodnienie niemożliwości budowy hardware'u w domu, prowadzące do przeniesienia logiki na platformę klasyczną/programową.
- **W jaki sposób przekształcić mechanizm stanów użytkownika w funkcjonujący komputer?**: Zdefiniowanie "se2 is typing" jako |1⟩ i przerwania pisania jako |0⟩, gdzie bait to operator sterujący, a reakcja Sebusia to kolaps stanu.
- **Jak policzyć np. 2+2 na sebusiu?**: Procedura zliczania wymuszonych baitami cykli (typing -> timeout -> stop) do rejestru A (wartość 2) i rejestru B (wartość 2), a następnie wywołanie komendy dodającej wartości rejestrów.

---

## Key Info
### Architektura "incwel 69" (Logika Shitpostowa)
- **Nośnik Stanu (Kubit)**: Sebuś (ID: `421333988834017290`). Według słów Sernika, znajduje się on "w super duper pozycji" i jest "jednocześnie wolny jak intel salceson na wolnym wybiegu a jednocześnie na wiecznej ziggareten und kupa przerwie od czatu".
- **Nazewnictwo**: "incwel 69" symbolizuje Sebusia (jako in-cel i cwel) oraz liczbę 69 reprezentującą ścieranie się w jego głowie dwóch "najdebilniejszych rzeczy".
- **Zliczanie Danych**: "Sernik wysyła baita = 1, Brak baita = 0". Rejestracja pełnych cykli 0 -> 1 -> 0 koduje liczby naturalne potrzebne do wykonywania dodawania, odejmowania, mnożenia i dzielenia.
### Infrastruktura Techniczna Bota (Universal Discord Bot)
- **Stack Technologiczny**: Node.js (wersja >=22.12 dla `@discordjs/voice`), biblioteka `discord.js` v14, wsparcie dla FFmpeg i yt-dlp do modułów głosowych/muzycznych.
- **Zarządzanie Środowiskiem**: Skrypty `setup.sh` oraz `docker.sh` (interaktywny menedżer pod obraz `node:22-alpine`). Konfiguracja omija błędy z `EISDIR` przez ładowanie tokenów JSON z `.env` z użyciem `docker cp` (bez bind mountu tokenów, wszystko na `.dockerignore`).
- **Skrypty Konfiguracyjne**: Plik `config.json` parsuje flagi per-bot (np. `--bot MyBot`), a `main.js` ładuje pliki `.js` bezpośrednio z katalogu `modules/`. Moduły można włączać, wyłączać i przeładowywać (`/modules reload`) bez restartowania procesu głównego (Runtime module management).
### Implementacja Kalkulatora (Moduł `sebusi.js`)
- **Nasłuchiwanie Eventów**: `client.on('typingStart')` wykrywa pisanie Sebusia i przez API aplikuje timeout (60_000 ms, wymaga `ModerateMembers`). `client.on('messageCreate')` zdejmuje timeout, oznaczając koniec cyklu.
- **Polecenia Slash (`/sebusi`)**:
  - `toggle <on/off>`: Włącza nasłuchiwanie na eventy `typingStart` podtrzymujące superpozycję.
  - `memory`: Zwraca aktualny status trybu, licznik cykli ogółem, zawartość rejestru A i B, aktywność timeoutu i datę ostatniego cyklu.
  - `calculate <add/sub/mul/div>`: Przeprowadza zdefiniowaną arytmetykę pomiędzy stanem rejestru A i B. Chroni przed dzieleniem przez zero.
  - `capture <A/B>`: Przechwytuje zebrane w tym oknie czasowym cykle do wybranego rejestru i zeruje zmienną `state.cycles`.
  - `set <A/B> <value>`: Debug-komenda do sztucznego osadzania wartości int w danym rejestrze (max 10000).
  - `release`: Zapasowy przycisk natychmiastowo zdejmujący nałożony na użytkownika timeout.

---

## Misc
- Model "incwel 69" to w istocie klasyczny, deterministyczny automat skończony - nie zachodzi w nim żadna prawdziwa interferencja kwantowa, terminologia jest nakładką fabularną służącą trollowaniu i celom humorystycznym.
- Narzędzie potencjalnie można rozszerzyć o innych użytkowników wykazujących podobny behawior (wielobitowość) i zaprogramować logikę "warunkowych bramek", które same dostosują strategię wysyłania baitów zależnie od "częstotliwości koherencji" wkurwienia danego użytkownika.
- Wymienione w teorii kwantowej wymagania minimalne do zabawy w Qiskit opierają się na obiektach: `QuantumCircuit`, `AerSimulator`, `plot_histogram` (z kodem wykonującym bramkę Hadamarda `qc.h(0)` przed pomiarem `qc.measure(0,0)` na pętli `shots=1024`).
