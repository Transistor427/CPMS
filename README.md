# CPMS
Central printer monitoring system

## Скачивание и установка
```bash
cd ~ && git clone https://github.com/Transistor427/CPMS && cd ~/CPMS && python3 -m venv env && ~/CPMS/env/bin/pip install -r ~/CPMS/requirements.txt && sudo ln -s ~/CPMS/cpms.service /etc/systemd/system/ && sudo systemctl enable --now cpms.service
```
