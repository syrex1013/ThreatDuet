export const PL_APP: Record<string, string> = {
  // lib.ts
  Today: 'Dziś',
  Yesterday: 'Wczoraj',
  Tomorrow: 'Jutro',
  Now: 'Teraz',
  now: 'teraz',
  'at {time}': 'o {time}',
  'tomorrow at {time}': 'jutro o {time}',
  'on {date} at {time}': '{date} o {time}',
  'Morning brief': 'Poranne podsumowanie',
  'Check-in': 'Sprawdzenie',
  'Evening report': 'Raport wieczorny',
  'Follow-up': 'Przypomnienie',
  'Task finished': 'Zadanie ukończone',
  'read {n} files': 'odczytano {n} plik|odczytano {n} pliki|odczytano {n} plików',
  'searched the workspace': 'przeszukano obszar roboczy',
  'searched the web': 'przeszukano internet',
  'opened {n} web pages': 'otwarto {n} stronę|otwarto {n} strony|otwarto {n} stron',
  'used its computer': 'użyto komputera Duet',
  'used your computer': 'użyto Twojego komputera',
  'used {app}': 'użyto {app}',
  No: 'Zero',
  One: 'Jedna',
  Two: 'Dwie',
  Three: 'Trzy',
  Four: 'Cztery',
  Five: 'Pięć',
  Six: 'Sześć',
  Seven: 'Siedem',
  Eight: 'Osiem',
  Nine: 'Dziewięć',

  // App.tsx
  'OpenDuet home': 'Strona główna OpenDuet',
  "Couldn't send that. {error}": 'Nie udało się wysłać. {error}',
  'Run now': 'Uruchom teraz',
  'Brief me': 'Podsumuj',
  'Anything urgent, mistakes or conflicts in my schedule, messages waiting on me, unpaid invoices.':
    'Wszystko pilne, błędy lub konflikty w kalendarzu, wiadomości czekające na mnie, nieopłacone faktury.',
  'Check in': 'Sprawdź',
  'Write report': 'Napisz raport',
  'Made by Duet': 'Zrobione przez Duet',
  "Duet's computer": 'Komputer Dueta',
  'Your {device}': 'Twój {device}',
  Apps: 'Aplikacje',
  Settings: 'Ustawienia',
  'Full window': 'Pełne okno',
  'Compact window': 'Kompaktowe okno',
  Status: 'Status',
  "Can't reach your computer right now. Showing what Duet last sent.":
    'Nie można teraz połączyć się z komputerem. Pokazuję to, co Duet wysłał ostatnio.',
  "Can't reach your computer.": 'Nie można połączyć się z komputerem.',
  'Reconnecting to Duet…': 'Ponowne łączenie z Duet…',
  'The OpenDuet server is not running. Start it with npm start, then retry.':
    'Serwer OpenDuet nie działa. Uruchom go poleceniem npm start i spróbuj ponownie.',
  Retry: 'Ponów',
  'Pair again': 'Sparuj ponownie',

  // Composer.tsx
  'Message Duet': 'Wiadomość do Duet',
  'Hand Duet a task, or ask anything': 'Zleć Duet zadanie albo zapytaj o cokolwiek',
  'Stop dictation': 'Zatrzymaj dyktowanie',
  'Dictate a message': 'Podyktuj wiadomość',
  Dictate: 'Dyktuj',
  Send: 'Wyślij',
  'Enter to send. Shift+Enter for a new line.': 'Enter, aby wysłać. Shift+Enter, aby zacząć nową linię.',

  // Channels.tsx
  'new reply': 'nowa odpowiedź',
  Channels: 'Kanały',
  Main: 'Główny',
  'Close this channel (its messages move to Main)': 'Zamknij ten kanał (jego wiadomości trafią do Głównego)',
  'Close channel, messages move to Main': 'Zamknij kanał, wiadomości trafią do Głównego',
  'Channel name': 'Nazwa kanału',
  'New channel name': 'Nazwa nowego kanału',
  'New channel': 'Nowy kanał',

  // Make.tsx
  'Looking in the workspace…': 'Przeglądam obszar roboczy…',
  'Nothing yet. Files Duet writes in its workspace show up here.':
    'Na razie nic. Tu pojawią się pliki, które Duet zapisze w swoim obszarze roboczym.',

  // FileViewer.tsx
  'In {path}, change only this part:': 'W {path} zmień tylko ten fragment:',
  'In {path}: {instruction}': 'W {path}: {instruction}',
  "This file can't be previewed here. Open it from the workspace folder.":
    'Tego pliku nie da się tu wyświetlić. Otwórz go z folderu obszaru roboczego.',
  'Opening {path}…': 'Otwieram {path}…',
  Preview: 'Podgląd',
  Source: 'Źródło',
  'Preview of {path}': 'Podgląd {path}',
  'Ask Duet to change the selected part': 'Poproś Duet o zmianę zaznaczonego fragmentu',
  'Ask Duet to change this': 'Poproś Duet o zmianę',
  'Select text first to change only that part': 'Najpierw zaznacz tekst, aby zmienić tylko ten fragment',
  "Saved in Duet's workspace folder as {path}.": 'Zapisano w folderze obszaru roboczego Duet jako {path}.',

  // Sheet.tsx
  Close: 'Zamknij',

  // PairScreen.tsx
  'Enter the address shown on your computer, like 100.64.0.10:4320.':
    'Wpisz adres widoczny na komputerze, np. 100.64.0.10:4320.',
  'Enter the pairing code shown on your computer.': 'Wpisz kod parowania widoczny na komputerze.',
  'Pair with your computer.': 'Sparuj z komputerem.',
  'Duet works on your computer. This app shows you its briefs, asks you for approvals and lets you hand it tasks from anywhere.':
    'Duet pracuje na Twoim komputerze. Ta aplikacja pokazuje jego przeglądy, prosi Cię o zatwierdzenia i pozwala zlecać mu zadania z dowolnego miejsca.',
  'On your computer, open OpenDuet, then Settings, then Phone.': 'Na komputerze otwórz OpenDuet, potem Ustawienia, a następnie Telefon.',
  'Turn on phone access.': 'Włącz dostęp z telefonu.',
  "Scan the code with your phone's camera.": 'Zeskanuj kod aparatem telefonu.',
  'Or enter it by hand': 'Albo wpisz ręcznie',
  'Computer address': 'Adres komputera',
  'Pairing code': 'Kod parowania',
  'Pairing…': 'Parowanie…',
  'Pair phone': 'Sparuj telefon',

  // phone.ts
  "Can't reach {url}. Check that OpenDuet is running on your computer and that both devices are on Tailscale or the same network.":
    'Nie można połączyć się z {url}. Sprawdź, czy OpenDuet działa na komputerze i czy oba urządzenia są w Tailscale lub w tej samej sieci.',
  "The pairing code doesn't match. On your computer, open Settings, then Phone, and scan the code again.":
    'Kod parowania się nie zgadza. Na komputerze otwórz Ustawienia, potem Telefon, i zeskanuj kod ponownie.',
  'Your computer answered with an error ({status}). Try again in a moment.':
    'Komputer odpowiedział błędem ({status}). Spróbuj ponownie za chwilę.',
  // Setup.tsx
  'Welcome to OpenDuet': 'Witaj w OpenDuet',
  'About you': 'O Tobie',
  'Your day': 'Twój dzień',
  'Connect your things': 'Połącz swoje rzeczy',
  "You're ready": 'Gotowe',
  'Step {n} of {total}': 'Krok {n} z {total}',
  'Duet works next to you: it watches what matters, briefs you in the morning, and asks before it does anything that affects others.':
    'Duet pracuje obok Ciebie: pilnuje tego, co ważne, rano przygotowuje podsumowanie i pyta o zgodę, zanim zrobi coś, co dotyczy innych.',
  'Your name (optional)': 'Twoje imię (opcjonalnie)',
  'What do you do, and what are you working on?': 'Czym się zajmujesz i nad czym teraz pracujesz?',
  'What should Duet watch for?': 'Czego Duet ma pilnować?',
  'Duet is more useful when it can see your email, calendar and files. All of this is optional, and you can connect things later from the top bar.':
    'Duet jest bardziej przydatny, gdy widzi Twoją pocztę, kalendarz i pliki. To wszystko jest opcjonalne i możesz to połączyć później z górnego paska.',
  'Connected: {n} apps': 'Połączone: {n} aplikacja|Połączone: {n} aplikacje|Połączone: {n} aplikacji',
  "Duet will introduce itself in the thread and suggest its first tasks. You'll find them in the side panel.":
    'Duet przedstawi się w wątku i zaproponuje pierwsze zadania. Znajdziesz je w panelu bocznym.',
  'Your name': 'Twoje imię',
  'every {n} h': 'co {n} godz.',
  off: 'wyłączone',
  'Quiet hours': 'Godziny ciszy',
  'Skip setup': 'Pomiń konfigurację',
  Back: 'Wstecz',
  Next: 'Dalej',
  'Start working with Duet': 'Zacznij pracę z Duetem',
};
