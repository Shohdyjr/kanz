# صورة Node.js خفيفة (Alpine) — كل اللي محتاجينه بس، عشان الحجم يفضل صغير
FROM node:20-alpine

WORKDIR /app

# بننسخ ملفات الـ package الأول لوحدهم عشان نستفيد من الـ Docker cache
# (لو الكود اتغيّر بس الـ dependencies لأ، مش هيعيد تثبيتهم من الصفر)
COPY package*.json ./
RUN npm install --omit=dev

# دلوقتي بننسخ باقي الكود
COPY . .

EXPOSE 3000

CMD ["npm", "start"]
