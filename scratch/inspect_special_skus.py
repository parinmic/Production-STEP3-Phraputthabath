import pandas as pd
df = pd.read_excel('Mas Special SKU.xlsx')
row = df.iloc[21]
print("Type of start time:", type(row['ช่วงเวลาเริ่มผลิต']))
print("Value of start time:", repr(row['ช่วงเวลาเริ่มผลิต']))
