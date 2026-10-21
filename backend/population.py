"""可視化専用の人口データを検証し、5歳階級に集計する。"""

import numpy as np
import pandas as pd
from fastapi import HTTPException
from pydantic import BaseModel, Field


class PyramidConfig(BaseModel):
    sheet_name: str = Field(min_length=1)
    municipality_column: str
    sex_column: str
    age_column: str
    population_column: str


class PopulationBand(BaseModel):
    age_start: int = Field(ge=0, le=100, multiple_of=5)
    male: int
    female: int


class MunicipalityPopulation(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    bands: list[PopulationBand] = Field(min_length=1, max_length=21)


class PopulationPyramidData(BaseModel):
    sheet_name: str = Field(min_length=1, max_length=200)
    cities: list[MunicipalityPopulation] = Field(min_length=1, max_length=10000)
    warnings: list[str] = Field(default_factory=list)


def population_pyramid(frame, config):
    columns = [config.municipality_column, config.sex_column, config.age_column, config.population_column]
    if len(set(columns)) != 4 or any(column not in frame.columns for column in columns):
        raise HTTPException(400, "人口ピラミッドの市町村・性別・年齢・人口には、存在する別々の列を選択してください")
    data = frame[columns].dropna(how='all').copy()
    if data.empty or data.isna().any().any():
        raise HTTPException(400, "人口ピラミッドのデータが空か、指定した列に欠損があります")
    cities = data.iloc[:, 0].astype(str).str.strip()
    sexes = data.iloc[:, 1].astype(str).str.strip().str.lower().map({
        '男': 'male', '男性': 'male', 'male': 'male', 'm': 'male',
        '女': 'female', '女性': 'female', 'female': 'female', 'f': 'female',
    })
    age_text = data.iloc[:, 2].astype(str).str.strip()
    ages = pd.to_numeric(age_text.str.extract(r'^(\d+)(?:\.0+)?(?:歳)?(?:以上|\+)?$', expand=False), errors='coerce')
    populations = pd.to_numeric(data.iloc[:, 3], errors='coerce')
    if cities.eq('').any() or sexes.isna().any():
        raise HTTPException(400, "市町村名は空欄にせず、性別は男・女（男性・女性）で指定してください")
    if ages.isna().any() or not np.isfinite(ages).all():
        raise HTTPException(400, "年齢は0以上の整数で指定してください（100歳以上も使用できます）。階級別ではなく各歳別のデータを選択してください")
    if (age_text.str.contains(r'(?:以上|\+)$') & (ages < 100)).any():
        raise HTTPException(400, "100歳未満は各歳別のデータを指定してください。階級別のデータには対応していません")
    if not np.isfinite(populations).all() or (populations % 1 != 0).any():
        raise HTTPException(400, "人口は欠損のない有限の整数で指定してください")
    negative_rows = populations < 0
    warnings = []
    if negative_rows.any():
        examples = '、'.join(
            f"{city} {'男' if sex == 'male' else '女'} {int(age)}歳"
            for city, sex, age in zip(cities[negative_rows].head(3), sexes[negative_rows].head(3), ages[negative_rows].head(3))
        )
        warnings.append(f"人口がマイナスの行が{int(negative_rows.sum())}件あります（{examples} など）。そのまま集計しています。")
    age_starts = (ages.clip(upper=100).astype(int) // 5 * 5).tolist()
    maximum = max(age_starts)
    grouped = {}
    for city, sex, age, count in zip(cities, sexes, age_starts, populations):
        if city not in grouped:
            grouped[city] = {start: {'age_start': start, 'male': 0, 'female': 0} for start in range(0, maximum + 1, 5)}
        grouped[city][age][sex] += int(count)
    return PopulationPyramidData(sheet_name=config.sheet_name, warnings=warnings, cities=[
        MunicipalityPopulation(name=city, bands=list(bands.values())) for city, bands in grouped.items()
    ]).model_dump()
