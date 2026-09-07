import requests
import base64
import json
from datetime import datetime

class TVTokenGenerator:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            'accept': 'application/json, text/plain, */*',
            'cache-control': 'no-cache, no-store, must-revalidate',
            'pragma': 'no-cache',
            'expires': '0',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:136.0) Gecko/20100101 Firefox/136.0 /OS.Gatu v1.0',
            'Connection': 'Keep-Alive',
            'Accept-Encoding': 'gzip'
        })
    
    def get_base_url(self):
        """Get the base URL from the first endpoint"""
        url = "https://mobiledetects.com/checknewtv.php"
        headers = {
            'x-requested-with': 'NetmirrorNewTV v1.0'
        }
        response = self.session.get(url, headers=headers)
        response.raise_for_status()
        data = response.json()
        
        # Decode token_hash to get the base URL
        if data.get('token_hash'):
            decoded = base64.b64decode(data['token_hash']).decode('utf-8')
            # Extract domain from URL
            base_url = decoded.replace('https://', '').replace('http://', '').split('/')[0]
            return base_url, data
        return None, data
    
    def generate_token(self, otp):
        """Generate user token using the OTP you provide"""
        print(f"\n📝 Using OTP: {otp}")
        
        # Step 1: Get base URL
        base_url, first_response = self.get_base_url()
        if not base_url:
            raise Exception("Failed to get base URL")
        
        print(f"✅ Base URL: {base_url}")
        print(f"📊 First Response: {json.dumps(first_response, indent=2)}")
        
        # Step 2: Send OTP to get token
        url = f"https://{base_url}/newtv/otp.php"
        headers = {
            'otp': str(otp)
        }
        
        print(f"\n🔄 Sending OTP to: {url}")
        response = self.session.get(url, headers=headers)
        response.raise_for_status()
        
        data = response.json()
        
        # Check if OTP was valid
        if data.get('status') == 'ok' and data.get('usertoken'):
            print(f"\n✅ TOKEN GENERATED SUCCESSFULLY!")
            return data
        else:
            print(f"\n❌ Failed to generate token. Status: {data.get('status')}")
            return None

# ============ MAIN USAGE ============

def main():
    print("=" * 60)
    print("TV TOKEN GENERATOR - Enter OTP Manually")
    print("=" * 60)
    
    generator = TVTokenGenerator()
    
    # Get the OTP from user
    otp = input("\n🔑 Enter the OTP from the website: ").strip()
    
    if not otp:
        print("❌ No OTP entered!")
        return
    
    try:
        # Generate token
        result = generator.generate_token(otp)
        
        if result:
            print("\n" + "=" * 60)
            print("🎯 TOKEN GENERATED!")
            print("=" * 60)
            
            token = result.get('usertoken')
            print(f"\n📌 User Token: {token}")
            
            # Parse token
            if token:
                parts = token.split('::')
                print("\n📊 Token Parts:")
                if len(parts) >= 4:
                    print(f"  • User ID: {parts[0]}")
                    print(f"  • Hash: {parts[1]}")
                    timestamp = int(parts[2])
                    print(f"  • Timestamp: {timestamp} ({datetime.fromtimestamp(timestamp).strftime('%Y-%m-%d %H:%M:%S')})")
                    print(f"  • Device Code: {parts[3]}")
            
            # Show other info
            print(f"\n📋 Additional Info:")
            print(f"  • OTP: {result.get('otp')}")
            print(f"  • Status: {result.get('status')}")
            print(f"  • Public Message: {result.get('pub_msg') or 'None'}")
            print(f"  • Message Color: {result.get('pub_msg_color')}")
            
            if result.get('pub_msg_img'):
                qr = result['pub_msg_img']
                print(f"\n📱 QR Code Info:")
                print(f"  • Image URL: {qr.get('img')}")
                print(f"  • Max Height: {qr.get('maxh')}")
                print(f"  • Max Width: {qr.get('maxw')}")
            
            # Save token to file
            with open('generated_token.txt', 'w') as f:
                f.write(f"OTP: {otp}\n")
                f.write(f"Token: {token}\n")
                f.write(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
                f.write(f"\nFull Response:\n{json.dumps(result, indent=2)}")
            print(f"\n💾 Token saved to: generated_token.txt")
            
        else:
            print("\n❌ Failed to generate token. Check your OTP.")
            
    except requests.exceptions.RequestException as e:
        print(f"\n❌ Network Error: {e}")
    except Exception as e:
        print(f"\n❌ Error: {e}")

if __name__ == "__main__":
    main()
