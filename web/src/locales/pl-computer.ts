export const PL_COMPUTER: Record<string, string> = {
  // ComputerSheet
  "Duet's computer": 'Komputer Dueta',
  'Checking…': 'Sprawdzam…',
  'Give Duet its own computer in the cloud, with a browser. It can look things up and work there while your laptop and phone are off. Duet reads pages on its own; clicking, typing and running commands wait for your approval.':
    'Daj Duetowi własny komputer w chmurze, z przeglądarką. Może tam szukać informacji i pracować, gdy Twój laptop i telefon są wyłączone. Duet sam czyta strony; klikanie, pisanie i uruchamianie poleceń czeka na Twoją zgodę.',
  'Which machine should Duet use?': 'Której maszyny ma używać Duet?',
  '{state}, no browser': '{state}, bez przeglądarki',
  'There are no machines on this account yet. Create one with the agent-browser template, then come back.':
    'Na tym koncie nie ma jeszcze żadnej maszyny. Utwórz ją z szablonu agent-browser i wróć tutaj.',
  'This machine has no desktop browser. Duet needs one made from the agent-browser template.':
    'Ta maszyna nie ma przeglądarki z pulpitem. Duet potrzebuje maszyny utworzonej z szablonu agent-browser.',
  'This machine can read your Instabox Vault secrets. Anything Duet opens or runs there could reach them. Turn Vault off for this machine in the Instabox dashboard before connecting, or pick a machine that has it off.':
    'Ta maszyna ma dostęp do Twoich sekretów z Instabox Vault. Wszystko, co Duet tam otworzy lub uruchomi, mogłoby się do nich dostać. Przed połączeniem wyłącz Vault dla tej maszyny w panelu Instabox albo wybierz maszynę, która ma go wyłączonego.',
  'Duet works in its own folder on the machine and never deletes the machine.':
    'Duet pracuje we własnym folderze na maszynie i nigdy jej nie usuwa.',
  'Looking…': 'Szukam…',
  'Find my machines': 'Znajdź moje maszyny',
  'Connecting…': 'Łączę…',
  'Connect this machine': 'Połącz tę maszynę',
  Awake: 'Działa',
  'Asleep, wakes when Duet needs it': 'Uśpiona, budzi się, gdy Duet jej potrzebuje',
  'Switched off, starts when Duet needs it': 'Wyłączona, uruchamia się, gdy Duet jej potrzebuje',
  "Can't reach it right now": 'Nie mogę się teraz z nią połączyć',
  'Setup needs attention': 'Konfiguracja wymaga uwagi',
  'The first setup takes a minute or two.': 'Pierwsza konfiguracja trwa minutę lub dwie.',
  '{step} failed.': '{step} – nie udało się.',
  'Waking the computer': 'Budzenie komputera',
  'Installing the browser driver': 'Instalowanie sterownika przeglądarki',
  'Starting the browser': 'Uruchamianie przeglądarki',
  'Checking that it can browse': 'Sprawdzanie, czy może przeglądać strony',
  'Try again': 'Spróbuj ponownie',
  'This machine can read your Instabox Vault secrets. Turn Vault off for it in the Instabox dashboard.':
    'Ta maszyna ma dostęp do Twoich sekretów z Instabox Vault. Wyłącz dla niej Vault w panelu Instabox.',
  'Disconnect Duet from {name}? The machine stays as it is.': 'Odłączyć Dueta od maszyny {name}? Maszyna pozostanie bez zmian.',
  Disconnect: 'Odłącz',
  Keep: 'Zostaw',
  'Disconnect…': 'Odłącz…',
  'Watch the browser': 'Podgląd przeglądarki',
  Watch: 'Podgląd',
  'The computer is asleep. Looking at it wakes it up, and it keeps running until it has been idle for a while.':
    'Komputer jest uśpiony. Podgląd go obudzi, a potem będzie działał, dopóki przez jakiś czas nie będzie bezczynny.',
  'Wake it and look': 'Obudź i pokaż',
  "The browser on Duet's computer: {page}": 'Przeglądarka na komputerze Dueta: {page}',
  'blank page': 'pusta strona',
  'Loading the screen': 'Wczytywanie ekranu',
  'Type into the page': 'Wpisz na stronie',
  'Click a field in the picture, then type here': 'Kliknij pole na obrazie, a potem pisz tutaj',
  'Type and press Enter': 'Wpisz i naciśnij Enter',
  'You are in control here: clicks and typing go straight to the page without asking. Use it to sign in to a site for Duet.':
    'Tu sterujesz Ty: kliknięcia i wpisywany tekst trafiają prosto na stronę, bez pytania o zgodę. Użyj tego, by zalogować Dueta na jakiejś stronie.',

  // MacSheet
  'Your Mac': 'Twój Mac',
  'Your PC': 'Twój komputer',
  'Let Duet use this Mac. Everything is off until you turn it on. Duet looks on its own; anything that changes something waits for your approval.':
    'Pozwól Duetowi korzystać z tego Maca. Wszystko jest wyłączone, dopóki tego nie włączysz. Duet sam przegląda; wszystko, co coś zmienia, czeka na Twoją zgodę.',
  'Let Duet use this PC. Everything is off until you turn it on. Duet looks on its own; anything that changes something waits for your approval.':
    'Pozwól Duetowi korzystać z tego komputera. Wszystko jest wyłączone, dopóki tego nie włączysz. Duet sam przegląda; wszystko, co coś zmienia, czeka na Twoją zgodę.',
  Files: 'Pliki',
  'Let Duet read and search my files': 'Pozwól Duetowi czytać i przeszukiwać moje pliki',
  "Writing a file always waits for approval. Folders with passwords and keys (AppData credential stores, browser data, OpenDuet's own data) stay off-limits even inside a folder you add.":
    'Zapis pliku zawsze czeka na zgodę. Foldery z hasłami i kluczami (magazyny poświadczeń w AppData, dane przeglądarek, dane samego OpenDuet) pozostają niedostępne, nawet wewnątrz dodanego folderu.',
  Where: 'Gdzie',
  'Folders I choose': 'Wybrane foldery',
  'Everything on this Mac': 'Wszystko na tym Macu',
  'Everything on this PC': 'Wszystko na tym komputerze',
  'Duet can open any folder on this Mac that you can, except the credential stores above. Searches without a folder start in your home folder.':
    'Duet może otworzyć każdy folder na tym Macu, do którego Ty masz dostęp, poza wymienionymi wyżej magazynami poświadczeń. Wyszukiwanie bez podanego folderu zaczyna się w Twoim folderze domowym.',
  'Duet can open any folder and drive on this PC that you can, except the credential stores above. Searches without a folder start in your user folder.':
    'Duet może otworzyć każdy folder i dysk na tym komputerze, do którego Ty masz dostęp, poza wymienionymi wyżej magazynami poświadczeń. Wyszukiwanie bez podanego folderu zaczyna się w Twoim folderze użytkownika.',
  'Open Privacy & Security settings': 'Otwórz ustawienia Prywatność i ochrona',
  'macOS keeps Mail, Messages, Safari and backups closed until you add OpenDuet under Full Disk Access. Other folders ask the first time Duet opens them.':
    'macOS nie udostępnia Poczty, Wiadomości, Safari ani kopii zapasowych, dopóki nie dodasz OpenDuet w sekcji Pełny dostęp do dysku. Inne foldery pytają o zgodę, gdy Duet otwiera je po raz pierwszy.',
  'The first time Duet opens Documents, Desktop or Downloads, macOS asks you to allow it.':
    'Gdy Duet po raz pierwszy otwiera Dokumenty, Biurko lub Pobrane, macOS prosi Cię o zgodę.',
  'Let Duet propose PowerShell commands': 'Pozwól Duetowi proponować polecenia PowerShell',
  'Auto mode': 'Tryb automatyczny',
  'Let Duet act on this Mac without asking (allow all)': 'Pozwól Duetowi działać na tym Macu bez pytania (zezwól na wszystko)',
  'Let Duet act on this PC without asking (allow all)': 'Pozwól Duetowi działać na tym komputerze bez pytania (zezwól na wszystko)',
  'Everything turned on above runs on its own: writing files, running commands, opening pages, clicking and typing as you. No proposal, no approval. Duet is still told not to delete, send or pay unasked, but nothing enforces it.':
    'Wszystko włączone powyżej działa samo: zapis plików, uruchamianie poleceń, otwieranie stron, klikanie i pisanie jako Ty. Bez propozycji, bez zatwierdzania. Duet nadal ma polecenie, by nie usuwać, nie wysyłać i nie płacić bez prośby, ale nic tego nie wymusza.',
  "Writing a file always waits for approval. Folders with passwords and keys (~/.ssh, Keychains, browser data, OpenDuet's own data) stay off-limits even inside a folder you add.":
    'Zapis pliku zawsze czeka na zgodę. Foldery z hasłami i kluczami (~/.ssh, pęki kluczy, dane przeglądarek, dane samego OpenDuet) pozostają niedostępne, nawet wewnątrz dodanego folderu.',
  Remove: 'Usuń',
  "No folders yet. Duet can't see any file until you add one.": 'Brak folderów. Duet nie widzi żadnego pliku, dopóki nie dodasz folderu.',
  'Folder to add': 'Folder do dodania',
  'Add folder': 'Dodaj folder',
  Browser: 'Przeglądarka',
  'Let Duet browse signed in as me': 'Pozwól Duetowi przeglądać strony zalogowany jako ja',
  "Duet opens a browser out of sight with a copy of your sign-ins, so it can use Gmail, calendars and dashboards. The copy stays in OpenDuet's private folder and is deleted when you turn this off, switch browser or quit. Duet never sees the cookies themselves, only the pages. Reading a page is automatic; clicking, typing and submitting wait for approval, and happen as you.":
    'Duet otwiera w tle przeglądarkę z kopią Twoich zalogowań (plików cookie), więc może korzystać z Gmaila, kalendarzy i paneli. Kopia leży w prywatnym folderze OpenDuet i jest usuwana, gdy to wyłączysz, zmienisz przeglądarkę lub zamkniesz aplikację. Duet nigdy nie widzi samych plików cookie, tylko strony. Czytanie strony odbywa się automatycznie; klikanie, pisanie i wysyłanie czeka na zgodę i dzieje się w Twoim imieniu.',
  'Brave, Chrome or Firefox must be installed.': 'Musisz mieć zainstalowaną przeglądarkę Brave, Chrome lub Firefox.',
  'Take sign-ins from': 'Źródło zalogowań',
  'Whichever is installed': 'Dowolna zainstalowana',
  '{name} (not installed)': '{name} (niezainstalowana)',
  'Copy my sign-ins again': 'Skopiuj moje zalogowania ponownie',
  'Running for Duet now: {browser}.': 'Teraz działa dla Dueta: {browser}.',
  'Starts the next time Duet browses.': 'Uruchomi się, gdy Duet następnym razem otworzy stronę.',
  'Close the browser first if the copy fails, and use this after you sign in to something new.':
    'Jeśli kopiowanie się nie uda, najpierw zamknij przeglądarkę. Użyj tego też po zalogowaniu się w nowym miejscu.',
  Commands: 'Polecenia',
  'Let Duet propose shell commands': 'Pozwól Duetowi proponować polecenia powłoki',
  'With the Mac connected, text in a file, web page or email could try to steer Duet. Duet treats it as data and asks before it acts or sends anything, so read each proposal before you approve it.':
    'Gdy Mac jest podłączony, tekst w pliku, na stronie lub w e-mailu może próbować sterować Duetem. Duet traktuje go jako dane i pyta, zanim cokolwiek zrobi lub wyśle, więc czytaj każdą propozycję, zanim ją zatwierdzisz.',
  'With the PC connected, text in a file, web page or email could try to steer Duet. Duet treats it as data and asks before it acts or sends anything, so read each proposal before you approve it.':
    'Gdy komputer jest podłączony, tekst w pliku, na stronie lub w e-mailu może próbować sterować Duetem. Duet traktuje go jako dane i pyta, zanim cokolwiek zrobi lub wyśle, więc czytaj każdą propozycję, zanim ją zatwierdzisz.',
  'Let Duet use its cloud computer without asking (allow all)': 'Pozwól Duetowi używać komputera w chmurze bez pytania (zezwól na wszystko)',
  'Opening pages, clicking, typing, running commands and writing files on the cloud computer run on their own. No proposal, no approval. Your own computer keeps its own setting. Text in a page or file could steer Duet there, and it can open any page even with web pages off, so anything signed in on that machine is exposed.':
    'Otwieranie stron, klikanie, pisanie, uruchamianie poleceń i zapis plików na komputerze w chmurze działają same. Bez propozycji, bez zatwierdzania. Twój własny komputer ma osobne ustawienie. Tekst na stronie lub w pliku może tam sterować Duetem, a Duet może otworzyć każdą stronę nawet przy wyłączonych stronach WWW, więc wszystko, co jest zalogowane na tej maszynie, jest narażone.',
  'Password for this page': 'Hasło do tej strony',
  'Click the password field in the picture, then type here': 'Kliknij pole hasła na obrazku, potem wpisz je tutaj',
  'Password (sent only to the page, never to chat)': 'Hasło (tylko na stronę, nigdy do czatu)',
  'Fill password': 'Wypełnij hasło',
  'You are in control here: clicks and typing go straight to the page without asking. When a site asks for a password, click the field in the picture, type it above, then press Enter with the key below if needed. It never goes into the chat with Duet (it still travels through OpenDuet to the cloud browser).': 'Tu sterujesz Ty: kliknięcia i wpisywany tekst trafiają prosto na stronę, bez pytania o zgodę. Gdy strona prosi o hasło, kliknij pole na obrazku, wpisz je powyżej, a potem w razie potrzeby naciśnij Enter klawiszem poniżej. Hasło nigdy nie trafia do rozmowy z Duetem (nadal przechodzi przez OpenDuet do przeglądarki w chmurze).',

  'Duet needs your input': 'Duet potrzebuje Twojego wpisu',
  'Password': 'Hasło',
  'One-time code': 'Kod jednorazowy',
  'Your answer': 'Twoja odpowiedź',
  'This goes into Duet\'s cloud browser, not into the chat.': 'To trafia do przeglądarki w chmurze Dueta, nie do czatu.',
  'This goes into the browser on this computer, not into the chat.': 'To trafia do przeglądarki na tym komputerze, nie do czatu.',
  'Fill and continue': 'Wypełnij i kontynuuj',
  'Sending…': 'Wysyłanie…',
  'Cancel': 'Anuluj',
  'Copy sign-ins to Duet\'s computer': 'Skopiuj logowania na komputer Dueta',
  'Copying…': 'Kopiowanie…',
  'Sign-ins copied to the cloud browser.': 'Logowania skopiowane do przeglądarki w chmurze.',

  'Moves the OpenDuet browser session from this Mac/PC into the cloud browser so Duet stays signed in there.': 'Przenosi sesję przeglądarki OpenDuet z tego Maca/PC do przeglądarki w chmurze, żeby Duet pozostał tam zalogowany.',

  'Waiting for your input': 'Czeka na Twój wpis',

  'Live view of Duet\'s cloud browser. Click the page if you need to focus a field; your answer below is typed into it and never enters the chat.': 'Podgląd na żywo przeglądarki Dueta w chmurze. Kliknij stronę, jeśli trzeba ustawić pole; odpowiedź poniżej trafia tam i nigdy do czatu.',

  'Live view of the browser on this computer. Your answer below is typed into the field and never enters the chat.': 'Podgląd na żywo przeglądarki na tym komputerze. Odpowiedź poniżej trafia do pola i nigdy do czatu.',

  'The browser on this computer: {page}': 'Przeglądarka na tym komputerze: {page}',

  'Live view of the browser on this computer (Mac, Windows or Linux). Click any site\'s fields, then enter your answer below — it never goes into the chat.': 'Podgląd na żywo przeglądarki na tym komputerze (Mac, Windows lub Linux). Kliknij pola dowolnej strony, a poniżej wpisz odpowiedź — nigdy nie trafia do czatu.',

  'You are in control here: clicks and typing go straight to the page on this computer without asking. Works for any site. When a site asks for a password, click the field in the picture, type it above, then press Enter with the key below if needed. It never goes into the chat with Duet.': 'Tu sterujesz Ty: kliknięcia i wpisywany tekst trafiają prosto na stronę na tym komputerze, bez pytania. Działa na każdej stronie. Gdy strona prosi o hasło, kliknij pole na obrazku, wpisz je powyżej, a potem w razie potrzeby naciśnij Enter poniżej. Nigdy nie trafia do czatu z Duetem.',


  'Every command is shown to you in full first, and only the exact commands you approve can run. From a paired phone this needs “Use fully from phone” under Settings → Phone.': 'Każde polecenie jest najpierw pokazane w całości, a uruchomić można tylko dokładnie te, które zatwierdzisz. Z sparowanego telefonu wymaga to „Używaj w pełni z telefonu” w Ustawienia → Telefon.',
};
