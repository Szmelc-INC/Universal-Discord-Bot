
# **Universal-Discord-Bot**
> **A modular approach to Discord bots by Szmelc.INC** \
> **Modularity is key!, each module is standalone .py script in modules folder**  \
![image](https://github.com/user-attachments/assets/7f3494c0-581f-4398-b53a-11fce9e5695e)

---

# 📖 **Manual**  
> **Click to expand each category...**  
> `Commands` contains a compact list with descriptions.  
> For detailed information about individual commands and their usage, refer to the `Modules` section.

---

<details>
<summary><h3>📜 Commands</h3></summary>

#### **ADMIN COMMANDS**
```
shell          - Access server's shell (Poorman's terminal over Discord)
upload         - Upload local file from server to Discord
dm             - Send direct message from bot to specified user
listroles      - List all roles specified user has
addrole        - Add a role to user
removerole     - Remove role from user
startpresence  - Start rich presence
stoppresence   - Stop rich presence
updatepresence - Update rich presence
rm             - Advanced message removal
```

#### **USER COMMANDS**
```
yt           - Search for a video on YouTube
mp3          - Convert YT URL to mp3
mp4          - Convert YT URL to mp4
cmd          - Same as `shell` but very restricted
joke         - Tell joke (Polish jokes from sadistic.pl)
bomba        - Tell Kapitan Bomba quote
boner        - Tell Bogdan Boner quote
crypto       - Fetch recent cryptocurrency prices
losowe       - Fetch random meme from jbzd.com.pl/losowe
game         - Start Tictactoe game between two users
```
#### **VC [MUSIC]**
```
join    - Join user's voice channel
leave   - Leave voice channel
play    - Play song, or add to queue
stop    - Stop music
skip    - Skip current song
queue   - List current queue
```

#### **MISC**
```
textemoji    - Print some random text emojis
coinflip     - Flip a coin
diceroll     - Roll a dice (either D6 or D20)
randomstring - Generate random string of characters
```

#### **NSFW**
```
cycki        - Fetch random NSFW picture from zmarsa.pl
furry        - Fetch some furry arts
```

</details>

---

<details>
<summary><h3>🧩 Modules</h3></summary>

#### **Commands by Module:**

> `shell.py`
```bash
shell <COMMAND>
```

> `cmd.py`
```bash
cmd <[figlet/toilet/cowsay/fortune/uptime]>
```

> `yt.py`
```bash
yt "search query"
```

> `dlp.py`
```bash
mp3 <URL>
mp4 <URL>
```

> `file_upload.py`
```bash
upload #channel /path/to/file
```

> `dm.py`
```bash
dm @user <Message>
```

> `tictactoe.py`
```bash
game @user1 @user2
```

> `role_manager.py`
```bash
listroles @user
addrole @user @role
removerole @user @role
```

> `rng.py`
```bash
coinflip
diceroll [6/20]
randomstring [Length]
```

> `losowe.py`
```bash
losowe
```

> `jokes.py`
```bash
joke
```

> `furry.py`
```bash
furry <search query>
```

> `emote.py`
```bash
textemoji
```

> `cycki.py`
```bash
cycki
```

> `crypto.py`
```bash
crypto
crypto <SYMBOL>
```

> `bomba.py`
```bash
bomba
```

> `boner.py`
```bash
boner
```

> `rich_presence.py`
```bash
startpresence
stoppresence
updatepresence <field> <value>
```

> `responses.py`
- Gives % for bot to reply to chat messages, see [misc/responses.txt] \
- Example responses.txt format:
```bash
keyword 1:reponse 1, response 2
keyword 2:response x, response y
```

> `music_vc.py`
```bash
join
leave
play <URL>
stop
skip
queue
```

> `shredder.py` \
> `[time]` uses format like: `5s`, `10m`, `1h` etc \
> add `--backup` flag to first backup and send to user issuing command, before deletion.
```bash
rm <@username> [time] 
rm <@username> [time] --backup
rm channel [time]
rm global [time]
```

</details>

---

<details>
<summary><h3>⚙️Setup & Config</h3></summary>

# Installation & Setup
> **Download source code with:**
```bash
git clone https://github.com/Szmelc-INC/Universal-Discord-Bot
cd Universal-Discord-Bot
```
> **Install dependencies with:**
```bash
python3 -m pip install -r requirements.txt
```
> **Now set your details like token, in `config.json`, when done, start the bot with:**
```bash
# CLI Interface
python3 main.py

# Directly
python3 main.py <bot_name>

# In Background (Bash)
nohup python3 main.py <bot_name> &
```

### config.json
> Configure multiple bots by specifying:  
> preferred name, token, prefix, path to modules, and optionally either white or blacklisted modules for each bot. \
> <bot_name> parameter is just for you to tell script which one you mean, tho try to avoid very special characters and spaces, \
> If bot name has spaces, add `""` around name while running start commands.
```json
{
  "<bot_name>": {
    "token": "TOKEN",
    "command_prefix": "!",
    "modules_folder": "modules",
    "enabled_modules": [],
    "disabled_modules": []
  },
  "Universal Bot": {
    "token": "TOKEN",
    "command_prefix": "/",
    "modules_folder": "/path/to/modules",
    "enabled_modules": [],
    "disabled_modules": ["examplemodule"]
  }
}
```
---
### responses.txt
> (One keyword, can have unlimited responses, which will be random picked each time it runs) \
> `:` separates keyword from responses, responses are separated by `,` \
> Set reply % chance in `responses.py` script.
> Configure trigger words & responses in such format:
```bash
keyword:response 1, response 2
```

</details>

---

<details>
<summary><h4>Misc</h4></summary>
  
> *Want to contribute? Feel free to reach out via Email, GitHub or Discord!*

> **Projects based on Universal-Discord-Bot <3**
- [e621 Discord Bot](https://github.com/AngryDraconequus/e621-discord-bot)


***"Not as good as other bots, but good enough!"***
</details>
