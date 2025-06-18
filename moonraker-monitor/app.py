import os
import json
import requests
from flask import Flask, render_template, request, jsonify, send_from_directory
import re

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = 'uploads'
CONFIG_FILE = 'config.json'


def load_config():
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, 'r') as f:
                return json.load(f)
        except:
            return {"printers": []}
    return {"printers": []}


def save_config(config):
    try:
        with open(CONFIG_FILE, 'w') as f:
            json.dump(config, f, indent=2)
        return True
    except Exception as e:
        print(f"Ошибка сохранения конфигурации: {e}")
        return False


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/get_config')
def get_config():
    return jsonify(load_config())


@app.route('/add_printer', methods=['POST'])
def add_printer():
    try:
        data = request.get_json()
        if not data or 'ip' not in data:
            return jsonify(error="Invalid request data"), 400

        ip = data['ip'].strip()

        if not ip.startswith('http'):
            ip = f'http://{ip}'

        config = load_config()

        if any(p['ip'] == ip for p in config['printers']):
            return jsonify(error="Printer already added"), 400

        config['printers'].append({
            "ip": ip,
            "name": f"Printer {len(config['printers']) + 1}",
            "webcam_available": True
        })

        if save_config(config):
            return jsonify(success=True)
        else:
            return jsonify(error="Failed to save configuration"), 500

    except Exception as e:
        return jsonify(error=str(e)), 500


@app.route('/delete_printer/<int:printer_id>', methods=['DELETE'])
def delete_printer(printer_id):
    try:
        config = load_config()
        if printer_id < 0 or printer_id >= len(config['printers']):
            return jsonify(error="Invalid printer ID"), 400

        del config['printers'][printer_id]

        if save_config(config):
            return jsonify(success=True)
        else:
            return jsonify(error="Failed to save configuration"), 500

    except Exception as e:
        return jsonify(error=str(e)), 500


@app.route('/printer_status/<int:printer_id>')
def printer_status(printer_id):
    try:
        config = load_config()
        if printer_id >= len(config['printers']):
            return jsonify(error="Printer not found"), 404

        printer = config['printers'][printer_id]
        base_url = printer['ip']

        # Проверка доступности принтера
        try:
            response = requests.get(f"{base_url}/server/info", timeout=3)
            response.raise_for_status()
        except Exception as e:
            return jsonify({
                "error": str(e),
                "status": "offline",
                "statusText": "Принтер недоступен"
            })

        # Получение данных о температурах
        temps = {}
        chamber_temp = 0

        try:
            # Запрашиваем extruder, exgtruder1 и heater_bed
            response = requests.get(f"{base_url}/printer/objects/query?extruder&extruder1&heater_bed", timeout=2)
            data = response.json()
            temps = data.get('result', {}).get('status', {})

            # Отдельный запрос для получения доступных сенсоров
            response = requests.get(f"{base_url}/printer/objects/query?heaters", timeout=2)
            heaters_data = response.json()
            available_sensors = heaters_data.get('result', {}).get('status', {}).get('heaters', {}).get(
                'available_sensors', {})

            # Ищем сенсор камеры в словаре available_sensors
            chamber_sensor_name = None
            for sensor_name in available_sensors:
                if "CHAMBER" in sensor_name.upper():
                    chamber_sensor_name = sensor_name
                    break

            # Если нашли сенсор камеры, запрашиваем его температуру
            if chamber_sensor_name:
                response = requests.get(f"{base_url}/printer/objects/query?{chamber_sensor_name}", timeout=2)
                sensor_data = response.json()
                chamber_temp = sensor_data.get('result', {}).get('status', {}).get(chamber_sensor_name, {}).get(
                    'temperature', {})
        except Exception as e:
            print(f"Ошибка получения температуры камеры: {e}")
            pass

        # Получение статуса печати
        print_stats = {}
        try:
            response = requests.get(f"{base_url}/printer/objects/query?print_stats", timeout=2)
            data = response.json()
            print_stats = data.get('result', {}).get('status', {}).get('print_stats', {})
        except:
            pass

        # Определение статуса принтера
        printer_state = print_stats.get('state', 'unknown')
        status_map = {
            'printing': 'Печать',
            'paused': 'Пауза',
            'complete': 'Завершено',
            'error': 'Ошибка',
            'standby': 'Ожидание',
            'cancelled': 'Отменено'
        }

        # Получаем имя файла без расширения для превью
        filename = print_stats.get('filename', 'Неизвестный файл')
        filename_without_ext = re.sub(r'\.[^.]*$', '', filename) if filename else ''

        return jsonify({
            "extruder_temp": temps.get('extruder', {}).get('temperature', 0),
            "extruder1_temp": temps.get('extruder1', {}).get('temperature', 0),
            "bed_temp": temps.get('heater_bed', {}).get('temperature', 0),
            "chamber_temp": chamber_temp,
            "filename": filename,
            "filename_without_ext": filename_without_ext,
            "status": printer_state,
            "statusText": status_map.get(printer_state, printer_state.capitalize()),
            "webcam_available": True
        })
    except Exception as e:
        return jsonify(error=str(e)), 500


@app.route('/update_printer/<int:printer_id>', methods=['POST'])
def update_printer(printer_id):
    try:
        config = load_config()
        if printer_id >= len(config['printers']):
            return jsonify(error="Printer not found"), 404

        printer = config['printers'][printer_id]

        if request.content_type.startswith('application/json'):
            data = request.get_json()
            if 'name' in data:
                printer['name'] = data['name']

        if save_config(config):
            return jsonify(success=True)
        else:
            return jsonify(error="Failed to save configuration"), 500

    except Exception as e:
        return jsonify(error=str(e)), 500


# Аварийная остановка
@app.route('/emergency_stop/<int:printer_id>', methods=['POST'])
def emergency_stop(printer_id):
    try:
        config = load_config()
        if printer_id >= len(config['printers']):
            return jsonify(error="Printer not found"), 404

        printer = config['printers'][printer_id]
        base_url = printer['ip']

        response = requests.post(f"{base_url}/printer/emergency_stop", timeout=3)

        if response.status_code == 200:
            return jsonify(success=True)
        else:
            return jsonify(error=response.text), response.status_code

    except Exception as e:
        return jsonify(error=str(e)), 500


# Пауза/возобновление печати
@app.route('/pause_resume_print/<int:printer_id>', methods=['POST'])
def pause_resume_print(printer_id):
    try:
        config = load_config()
        if printer_id >= len(config['printers']):
            return jsonify(error="Printer not found"), 404

        printer = config['printers'][printer_id]
        base_url = printer['ip']

        # Определяем текущее состояние
        response = requests.get(f"{base_url}/printer/objects/query?print_stats", timeout=2)
        data = response.json()
        state = data.get('result', {}).get('status', {}).get('print_stats', {}).get('state', '')

        if state == 'printing':
            # Пауза
            response = requests.post(f"{base_url}/printer/print/pause", timeout=3)
        elif state == 'paused':
            # Возобновление
            response = requests.post(f"{base_url}/printer/print/resume", timeout=3)
        else:
            return jsonify(error="Invalid state for pause/resume"), 400

        if response.status_code == 200:
            return jsonify(success=True)
        else:
            return jsonify(error=response.text), response.status_code

    except Exception as e:
        return jsonify(error=str(e)), 500


# Отмена печати
@app.route('/cancel_print/<int:printer_id>', methods=['POST'])
def cancel_print(printer_id):
    try:
        config = load_config()
        if printer_id >= len(config['printers']):
            return jsonify(error="Printer not found"), 404

        printer = config['printers'][printer_id]
        base_url = printer['ip']

        response = requests.post(f"{base_url}/printer/print/cancel", timeout=3)

        if response.status_code == 200:
            return jsonify(success=True)
        else:
            return jsonify(error=response.text), response.status_code

    except Exception as e:
        return jsonify(error=str(e)), 500


# Переключение подсветки
@app.route('/toggle_light/<int:printer_id>', methods=['POST'])
def toggle_light(printer_id):
    try:
        config = load_config()
        if printer_id >= len(config['printers']):
            return jsonify(error="Printer not found"), 404

        printer = config['printers'][printer_id]
        base_url = printer['ip']

        # Выполняем макрос LIGHT_SWITCH
        response = requests.post(
            f"{base_url}/printer/gcode/script",
            json={"script": "LIGHT_SWITCH"},
            timeout=3
        )

        if response.status_code == 200:
            return jsonify(success=True)
        else:
            return jsonify(error=response.text), response.status_code

    except Exception as e:
        return jsonify(error=str(e)), 500


if __name__ == '__main__':
    os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

    if not os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, 'w') as f:
            json.dump({"printers": []}, f)

    app.run(host='0.0.0.0', port=5000, debug=True)
