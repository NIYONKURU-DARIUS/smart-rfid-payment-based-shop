"""
RFID Card Top-Up System - ESP8266 Edge Controller
Team: Darius_Divine_Louise
"""

import time
import network
import machine
import ubinascii
import ujson
from umqtt.simple import MQTTClient
from machine import Pin, SPI
from mfrc522 import MFRC522

# ================= CONFIGURATION =================
TEAM_ID = "Darius_Divine_Louise"
WIFI_SSID = "RCA"
WIFI_PASS = "@RcaNyabihu2023"
MQTT_BROKER = "broker.benax.rw"
MQTT_PORT = 1883

# MQTT Topics
TOPIC_STATUS  = b"rfid/" + TEAM_ID.encode() + b"/card/status"
TOPIC_TOPUP   = b"rfid/" + TEAM_ID.encode() + b"/card/topup"
TOPIC_PAY     = b"rfid/" + TEAM_ID.encode() + b"/card/pay"
TOPIC_BALANCE = b"rfid/" + TEAM_ID.encode() + b"/card/balance"

CLIENT_ID = b"esp_" + ubinascii.hexlify(machine.unique_id())

# LED for status indication
led = Pin(2, Pin.OUT)
led.value(1)  # Off (inverted)

# ================= WIFI CONNECTION =================
def wifi_connect():
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
    if wlan.isconnected(): return True
    wlan.connect(WIFI_SSID, WIFI_PASS)
    retry = 0
    while not wlan.isconnected() and retry < 20:
        led.value(not led.value())
        time.sleep(0.5)
        retry += 1
    if wlan.isconnected():
        led.value(1)
        print("WiFi connected:", wlan.ifconfig()[0])
        return True
    return False

# ================= RFID SETUP =================
def setup_rfid():
    try:
        return MFRC522(sck=14, mosi=13, miso=12, rst=0, cs=2)
    except: return None

# In-memory card balance storage (local cache)
card_balances = {}

def blink_led(times, delay=0.1):
    for _ in range(times):
        led.value(0)
        time.sleep(delay)
        led.value(1)
        time.sleep(delay)

# ================= MQTT CALLBACK =================
def on_mqtt_msg(topic, msg):
    try:
        data = ujson.loads(msg)
        uid = data.get("uid")
        amount = data.get("amount", 0)
        
        if not uid: return

        if topic == TOPIC_TOPUP:
            if uid in card_balances: card_balances[uid] += amount
            else: card_balances[uid] = amount
            
            payload = {"uid": uid, "new_balance": card_balances[uid], "type": "topup", "timestamp": time.time()}
            client.publish(TOPIC_BALANCE, ujson.dumps(payload))
            print("✓ Top-up:", payload)
            blink_led(3)
            
        elif topic == TOPIC_PAY:
            if uid in card_balances: card_balances[uid] -= amount
            print("💳 Payment:", uid, "Amount:", amount)
            blink_led(1, 0.5)
            
    except Exception as e:
        print("MQTT Error:", e)

# ================= MQTT CONNECTION =================
def mqtt_connect():
    try:
        c = MQTTClient(CLIENT_ID, MQTT_BROKER, MQTT_PORT, keepalive=60)
        c.set_callback(on_mqtt_msg)
        c.connect()
        c.subscribe(TOPIC_TOPUP)
        c.subscribe(TOPIC_PAY)
        print("MQTT connected & subscribed")
        return c
    except Exception as e:
        print("MQTT connect error:", e)
        return None

# ================= MAIN LOOP =================
def main():
    global client
    if not wifi_connect(): machine.reset()
    rfid_reader = setup_rfid()
    if not rfid_reader: return
    client = mqtt_connect()
    if not client: machine.reset()
    
    print("✓ System ready")
    last_uid = None
    last_time = 0
    
    while True:
        try:
            client.check_msg()
            
            # Read RFID
            (stat, tag_type) = rfid_reader.request(rfid_reader.REQIDL)
            if stat == rfid_reader.OK:
                (stat, raw_uid) = rfid_reader.anticoll()
                if stat == rfid_reader.OK:
                    uid = "".join("{:02X}".format(x) for x in raw_uid)
                    now = time.time()
                    if uid != last_uid or (now - last_time) > 2:
                        if uid not in card_balances: card_balances[uid] = 0
                        payload = {"uid": uid, "balance": card_balances[uid], "timestamp": now}
                        client.publish(TOPIC_STATUS, ujson.dumps(payload))
                        print("📇 Scanned:", uid)
                        blink_led(1)
                        last_uid = uid
                        last_time = now
            time.sleep(0.1)
        except Exception as e:
            print("Loop error:", e)
            time.sleep(5)
            machine.reset()

if __name__ == "__main__":
    main()