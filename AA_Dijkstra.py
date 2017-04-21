#coding:utf-8

import numpy as np
from PIL import Image
import PIL.Image
import operator

class Edge:
    def __init__(self, _sLabel, _eLabel, _cost, _chr):
        self.sLabel = _sLabel
        self.eLabel = _eLabel
        self.cost = _cost
        self.chr = _chr
    
    @classmethod
    def frominstance(cls, _sLabel, instance):
        return cls(_sLabel, instance.eLabel, instance.cost, instance.chr)

class Distance:
    def __init__(self, _label, _distance):
        self.label = _label
        self.label_parent = -1
        self.distance = _distance

class Dijkstra:

    def __init__(self):
        pass

    def getEdges(self, _slabel, _labels2, _edges):
        outList = []
        for edge in _edges:
            if edge.sLabel != _slabel:
                continue
            else:
                for label in _labels2:
                    if edge.eLabel == label:
                        outList.append(edge)
        return outList

    def doDijkstra(self, _labels, _edges):

        self.labelsCount = len(_labels)

        Labels1 = []
        Labels2 = []

        # Nodeのラベル
        for label in _labels:
            Labels2.append(label)

        # Edgeのコスト
        Edges = []
        for edge in _edges:
            Edges.append(edge)

        # Nodeのコスト
        Distances = []
        for i in range(self.labelsCount):
            dist = 1.0e29
            if i == self.labelsCount - 1:
                dist = 0.0
            dist_tmp = Distance(_labels[i], dist)
            Distances.append(dist_tmp)

        route = []

        while len(Labels1) != self.labelsCount:
            
            min_distance = 1.0e30
            min_index = -1
            sLabelTmp = -1
            
            for i in range(len(Distances)):
                if Distances[i].distance < min_distance:
                    min_distance = Distances[i].distance
                    min_index = i
                    sLabelTmp = Distances[i].label

            assert sLabelTmp != -1, 'sLabelTmp is invalid!'
            assert min_index != -1, 'min_index is invalid!'

            Labels1.append(sLabelTmp)
            Labels2.remove(sLabelTmp)
            Distances.pop(min_index)
            
            edgesTmp = self.getEdges(sLabelTmp, Labels2, Edges)

            for edge in edgesTmp:
                
                eLabelTmp = edge.eLabel

                for i in range(len(Distances)):
                    
                    if Distances[i].label == eLabelTmp:
                        
                        if Distances[i].distance > min_distance + edge.cost:
                            Distances[i].distance = min_distance + edge.cost
                            Distances[i].label_parent = edge.sLabel
                            route.append(Edge.frominstance(sLabelTmp, edge))

        # http://d.hatena.ne.jp/r_ikeda/20111106/pythonsort
        route.sort(key=operator.attrgetter('eLabel'), reverse=False)

        return route
