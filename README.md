# CPMS
Central printer monitoring system

## Скачивание и установка
```bash
cd ~ && git clone https://github.com/Transistor427/CPMS && cd ~/CPMS && ~/CPMS/env/bin/pip install -r ~/CPMS/requirements.txt
sudo ln -s ~/CPMS/cpms.service /etc/systemd/system/
sudo systemctl enable --now cpms.service
```
